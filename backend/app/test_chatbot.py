import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.chatbot import (
    ChatRateLimiter,
    ChatRequest,
    build_catalog_snapshot,
    build_messages,
    call_openai_chat,
    chat,
    get_chat_status,
    lookup_order,
    rate_limiter,
    router,
)
from app.models import Base, Order, OrderItem, Product, User


class ChatbotTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.customer = User(
            full_name="Chat Customer",
            email="chat-customer@example.com",
            password_hash="not-used",
            role="customer",
        )
        self.other_customer = User(
            full_name="Other Customer",
            email="other-customer@example.com",
            password_hash="not-used",
            role="customer",
        )
        self.product = Product(
            name="Test Phone",
            brand="Test",
            category="phone",
            price=1000,
            sale_price=800,
            stock=3,
            specifications={"storage": "256GB"},
            is_active=True,
        )
        self.hidden_product = Product(
            name="Hidden Phone",
            brand="Test",
            category="phone",
            price=500,
            stock=0,
            is_active=False,
        )
        self.session.add_all([
            self.customer,
            self.other_customer,
            self.product,
            self.hidden_product,
        ])
        self.session.commit()
        self.order = Order(
            user_id=self.customer.id,
            recipient_name=self.customer.full_name,
            recipient_phone="0900000000",
            shipping_address="Private address",
            total_amount=1600,
            payment_method="cod",
            payment_status="unpaid",
            status="pending",
            items=[
                OrderItem(
                    product_id=self.product.id,
                    product_name=self.product.name,
                    unit_price=800,
                    quantity=2,
                    subtotal=1600,
                    stock_deducted=True,
                )
            ],
        )
        self.session.add(self.order)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_chat_status_never_exposes_api_key(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False):
            self.assertEqual(get_chat_status(), {
                "available": False,
                "message": "Chatbot AI chưa được cấu hình OPENAI_API_KEY.",
            })
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=False):
            status_response = get_chat_status()
            self.assertTrue(status_response["available"])
            self.assertNotIn("test-key", json.dumps(status_response))

    def test_catalog_uses_active_database_products_and_effective_prices(self):
        catalog = build_catalog_snapshot(self.session)
        self.assertEqual([item["product_id"] for item in catalog], [self.product.id])
        self.assertEqual(catalog[0]["price_vnd"], 800)
        self.assertEqual(catalog[0]["stock"], 3)
        self.assertIn("256GB", catalog[0]["specifications"])

    def test_chat_history_is_bounded_and_sent_as_user_context(self):
        request = ChatRequest(message="So sánh chúng", history=["Tôi cần điện thoại"])
        messages = build_messages(request, build_catalog_snapshot(self.session))
        self.assertEqual(messages[-2]["content"], "Tôi cần điện thoại")
        self.assertEqual(messages[-1]["content"], "So sánh chúng")
        self.assertIn(f'"product_id":{self.product.id}', messages[0]["content"])

        with self.assertRaises(ValueError):
            ChatRequest(message=" ", history=[])
        with self.assertRaises(ValueError):
            ChatRequest(message="Tư vấn", history=["x" * 1501])

    def test_chat_without_api_key_returns_explicit_unconfigured_error(self):
        request = SimpleNamespace(client=SimpleNamespace(host="chat-test"))
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False):
            with patch.object(rate_limiter, "check"):
                with self.assertRaises(HTTPException) as context:
                    asyncio.run(chat(
                        ChatRequest(message="Tư vấn điện thoại"),
                        request,
                        self.session,
                        None,
                    ))
        self.assertEqual(context.exception.status_code, 503)
        self.assertIn("chưa được cấu hình", context.exception.detail)

    def test_chat_passes_live_catalog_to_provider_and_returns_marked_ai_reply(self):
        request = SimpleNamespace(client=SimpleNamespace(host="configured-chat-test"))
        with patch.dict(os.environ, {"OPENAI_API_KEY": "local-test-key"}, clear=False):
            with patch.object(rate_limiter, "check"):
                with patch("app.chatbot.call_openai_chat", return_value="Tư vấn từ AI") as provider:
                    result = asyncio.run(chat(
                        ChatRequest(message="Tìm điện thoại", history=["Ngân sách 10 triệu"]),
                        request,
                        self.session,
                        self.customer,
                    ))

        self.assertEqual(result, {"reply": "Tư vấn từ AI", "source": "ai"})
        provider_messages = provider.call_args.args[0]
        self.assertIn(self.product.name, provider_messages[0]["content"])
        self.assertIn("800", provider_messages[0]["content"])
        self.assertEqual(provider_messages[-2]["content"], "Ngân sách 10 triệu")

    def test_rate_limit_rejects_excess_requests(self):
        limiter = ChatRateLimiter(limit=2, window_seconds=60)
        limiter.check(["ip:test"])
        limiter.check(["ip:test"])
        with self.assertRaises(HTTPException) as context:
            limiter.check(["ip:test"])
        self.assertEqual(context.exception.status_code, 429)

    def test_openai_response_is_parsed_without_logging_key(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"choices":[{"message":{"content":"Chao ban"}}]}'
        with patch("app.chatbot.urlopen", return_value=response):
            self.assertEqual(call_openai_chat([], "local-test-key"), "Chao ban")

    def test_order_lookup_only_returns_the_signed_in_users_order(self):
        request = SimpleNamespace(client=SimpleNamespace(host="order-test"))
        with patch.object(rate_limiter, "check"):
            result = lookup_order(
                SimpleNamespace(order_id=self.order.id),
                request,
                self.session,
                self.customer,
            )
            self.assertEqual(result.order_id, self.order.id)
            self.assertEqual(result.items[0].product_name, self.product.name)
            self.assertNotIn("Private address", result.model_dump_json())

            with self.assertRaises(HTTPException) as context:
                lookup_order(
                    SimpleNamespace(order_id=self.order.id),
                    request,
                    self.session,
                    self.other_customer,
                )
        self.assertEqual(context.exception.status_code, 404)

    def test_order_lookup_route_requires_authenticated_user(self):
        route = next(
            route for route in router.routes
            if isinstance(route, APIRoute)
            and route.path == "/api/chatbot/order-lookup"
        )
        self.assertTrue(
            any(dependency.call is get_current_user for dependency in route.dependant.dependencies)
        )


if __name__ == "__main__":
    unittest.main()
