export interface ChatbotFaq {
  id: string;
  keywords: string[];
  answer: string;
}

export const chatbotFaqs: ChatbotFaq[] = [
  {
    id: "greeting",
    keywords: ["xin chào", "chào", "hello", "hi", "shop ơi"],
    answer: "Xin chào! Tôi có thể tìm sản phẩm theo tên, thương hiệu, giá và tồn kho hiện tại."
  },
  {
    id: "shipping",
    keywords: ["giao hàng", "vận chuyển", "ship", "phí ship", "thời gian giao"],
    answer: "Thông tin phí và thời gian giao hàng cụ thể chưa được cấu hình. Vui lòng liên hệ HOANGDZ STORE để được xác nhận."
  },
  {
    id: "payment",
    keywords: ["thanh toán", "cod", "chuyển khoản", "ngân hàng"],
    answer: "HOANGDZ STORE hỗ trợ COD và chuyển khoản thủ công. Đơn chuyển khoản giữ trạng thái chưa thanh toán cho đến khi Admin xác nhận; hệ thống không tự giả lập thanh toán."
  },
  {
    id: "purchase",
    keywords: ["cách mua", "cach mua", "hướng dẫn mua", "huong dan mua", "đặt hàng", "dat hang", "mua hàng", "mua hang"],
    answer: "Bạn chọn sản phẩm, thêm vào giỏ, đăng nhập, kiểm tra giỏ và điền địa chỉ nhận hàng. Ở bước đặt hàng, chọn COD hoặc chuyển khoản thủ công rồi xác nhận đơn."
  },
  {
    id: "warranty",
    keywords: ["bảo hành", "bảo trì", "warranty"],
    answer: "Thời hạn và điều kiện bảo hành cụ thể chưa được cấu hình trong hệ thống. Vui lòng liên hệ cửa hàng và cung cấp mã sản phẩm để được tư vấn."
  },
  {
    id: "returns",
    keywords: ["đổi trả", "đổi hàng", "trả hàng", "hoàn tiền"],
    answer: "Chính sách đổi trả cụ thể chưa được cấu hình trong hệ thống. Vui lòng liên hệ cửa hàng để xác nhận điều kiện áp dụng."
  },
  {
    id: "order",
    keywords: ["đơn hàng", "mã đơn", "tra cứu đơn"],
    answer: "Bạn có thể đăng nhập rồi dùng mục “Tra cứu đơn hàng của tôi”. Thông tin chỉ được trả về cho chủ sở hữu đơn hàng."
  }
];

function normalizeFaqText(value: string): string {
  return value.toLocaleLowerCase("vi")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function findChatbotFaq(message: string): ChatbotFaq | null {
  const normalized = ` ${normalizeFaqText(message)} `;
  return chatbotFaqs.find(faq => faq.keywords.some(keyword =>
    normalized.includes(` ${normalizeFaqText(keyword)} `)
  )) || null;
}
