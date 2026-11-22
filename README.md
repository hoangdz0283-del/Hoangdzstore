## Chatbot AI (Phase 8)

The chatbot uses the OpenAI Chat Completions API through the FastAPI backend. It is
disabled until `OPENAI_API_KEY` is configured; without a key, the status endpoint
reports that AI is unavailable and chat requests return HTTP 503 rather than a
simulated answer.

1. Keep the existing database settings in `backend/.env`.
2. Add `OPENAI_API_KEY` and, optionally, `OPENAI_MODEL` using
   [`backend/.env.example`](./backend/.env.example) as a template. Never commit the
   actual key.
3. Restart the backend on port `8001`, then check `GET /api/chatbot/status`.
   Set `CORS_ORIGINS` to the exact comma-separated frontend origins in deployments;
   wildcard origins are rejected. Local development defaults include ports 5500,
   8000, and 8765.

The recommendation prompt receives active product IDs, names, brands, categories,
prices, stock counts, and product specifications from the current database. The
customer's question and up to eight earlier customer messages are sent to the
configured AI provider; order records and account data are not included. Order
lookup is a separate authenticated endpoint and only returns orders owned by the
signed-in customer.

Chat requests are limited to 10 per minute per client IP and signed-in account in
each backend process. This in-memory limit is suitable for the current single-process
setup; a multi-worker deployment should use a shared rate-limit store.