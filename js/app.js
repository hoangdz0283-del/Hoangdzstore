
// ==========================================
// HOANGDZ STORE - JAVASCRIPT
// ==========================================


// ==========================================
// 1. CAU HINH API
// ==========================================

const API_BASE_URL = String(window.HOANGDZ_API_BASE_URL || "").trim().replace(/\/+$/, "");
const PRODUCTS_DATA_URL = new URL("data/products.json", document.baseURI).toString();
const ANALYTICS_CONSENT_KEY = "hoangdz_analytics_consent";
const ANALYTICS_ID_KEY = "hoangdz_analytics_id";
const IMAGE_MANIFEST = window.HOANGDZ_IMAGE_MANIFEST || {};
const DEFAULT_IMAGE_FALLBACK = IMAGE_MANIFEST.defaultFallbackPath ||
    "assets/images/placeholders/unavailable.svg";


// ==========================================
// 2. KHAI BAO BIEN
// ==========================================

let products = [];
let checkoutIdempotencyKey = null;

function apiUrl(path) {
    if (!API_BASE_URL) {
        throw new Error("Backend Worker chưa được cấu hình. Hãy điền URL Worker trong js/config.js.");
    }

    let apiOrigin;
    try {
        apiOrigin = new URL(API_BASE_URL);
    } catch {
        throw new Error("URL Backend Worker trong js/config.js không hợp lệ.");
    }
    const isLocalApi = ["localhost", "127.0.0.1"].includes(apiOrigin.hostname);
    if (apiOrigin.protocol !== "https:" && !(isLocalApi && apiOrigin.protocol === "http:")) {
        throw new Error("Backend Worker phải sử dụng HTTPS.");
    }
    return `${apiOrigin.origin}${path}`;
}

function getAnalyticsId() {
    let id = localStorage.getItem(ANALYTICS_ID_KEY);
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        id = crypto.randomUUID();
        localStorage.setItem(ANALYTICS_ID_KEY, id);
    }
    return id;
}

function trackAnalytics(eventType, payload = {}) {
    if (localStorage.getItem(ANALYTICS_CONSENT_KEY) !== "accepted" || !API_BASE_URL) return;
    try {
        const body = {
            event_type: eventType,
            anonymous_id: getAnalyticsId(),
            consent: true,
            payload
        };
        const endpoint = apiUrl("/api/analytics/events");
        fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: true
        }).then(response => {
            if (!response.ok) console.warn("Không lưu được sự kiện phân tích (HTTP " + response.status + ").");
        }).catch(() => {
            console.warn("Không thể kết nối dịch vụ phân tích.");
        });
    } catch {
        console.warn("Không thể chuẩn bị sự kiện phân tích.");
    }
}

function initializeAnalyticsConsent() {
    const banner = document.getElementById("analytics-consent-banner");
    const consent = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    banner.hidden = consent === "accepted" || consent === "denied";
    document.body.classList.toggle("analytics-consent-open", !banner.hidden);

    document.getElementById("analytics-consent-accept").addEventListener("click", () => {
        localStorage.setItem(ANALYTICS_CONSENT_KEY, "accepted");
        banner.hidden = true;
        document.body.classList.remove("analytics-consent-open");
        trackAnalytics("page_view", { page: "home" });
    });
    document.getElementById("analytics-consent-decline").addEventListener("click", () => {
        localStorage.setItem(ANALYTICS_CONSENT_KEY, "denied");
        localStorage.removeItem(ANALYTICS_ID_KEY);
        banner.hidden = true;
        document.body.classList.remove("analytics-consent-open");
    });
    document.getElementById("analytics-consent-open").addEventListener("click", () => {
        banner.hidden = false;
        document.body.classList.add("analytics-consent-open");
    });
    if (consent === "accepted") trackAnalytics("page_view", { page: "home" });
}

const productList = document.getElementById("product-list");
const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const brandFilter = document.getElementById("brand-filter");
const priceMinInput = document.getElementById("price-min");
const priceMaxInput = document.getElementById("price-max");
const stockFilter = document.getElementById("stock-filter");
const productDetailModal = document.getElementById("product-detail-modal");
const productDetailContent = document.getElementById("product-detail-content");
const SHOWCASE_BRANDS = ["Apple", "Samsung", "ASUS", "LG", "Lenovo"];
const cartCount = document.getElementById("cart-count");
const cartItems = document.getElementById("cart-items");
const cartTotal = document.getElementById("cart-total");
const cartOverlay = document.getElementById("cart-overlay");
const checkoutModal = document.getElementById("checkout-modal");
const accountToggle = document.getElementById("account-toggle");
const customerOrdersSection = document.getElementById("customer-orders");
const customerOrdersList = document.getElementById("customer-orders-list");
const customerLoginModal = document.getElementById("customer-login-modal");
const customerOrderModal = document.getElementById("customer-order-modal");
const adminOrdersSection = document.getElementById("admin-orders");
const adminLoginModal = document.getElementById("admin-login-modal");
const adminOrderModal = document.getElementById("admin-order-modal");
const adminOrdersBody = document.getElementById("admin-orders-body");
const adminProductsBody = document.getElementById("admin-products-body");
const adminCustomersBody = document.getElementById("admin-customers-body");
const adminProductCache = new Map();

let currentCategory = "all";
let searchKeyword = "";
let currentBrand = "";
let visibleProductCount = 12;
let searchDebounceTimer = null;
let cart = [];
let currentUser = null;
let accountIntent = "profile";
let pendingCheckoutAuthResolver = null;
let adminOrdersPage = 1;
const adminOrdersPageSize = 20;
let adminProductsPage = 1;
let adminProductsTotalPages = 0;
let adminCustomersPage = 1;
let adminCustomersTotalPages = 0;
let adminCurrentView = "orders";
let currentAdminOrder = null;
let customerOrdersPage = 1;
let currentCustomerOrder = null;
let analyticsEvents = [];
let analyticsCursor = null;
let analyticsOrdersTotal = 0;
let analyticsOrdersByPeriod = {};
let analyticsRangeStart = null;
let analyticsRangeEnd = null;
let analyticsOrdersTruncated = false;
let analyticsDataMode = "production";

let accessToken = localStorage.getItem("hoangdz_token");

try {
    const savedCart = JSON.parse(localStorage.getItem("hoangdz_cart"));
    cart = Array.isArray(savedCart) ? savedCart : [];
} catch (error) {
    cart = [];
}


// ==========================================
// 3. DINH DANG TIEN
// ==========================================

function formatPrice(price) {
    return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND"
    }).format(price);
}


// ==========================================
// 4. XU LY THONG BAO LOI API
// ==========================================

function getApiErrorMessage(detail) {
    if (typeof detail === "string") {
        return detail;
    }

    if (Array.isArray(detail)) {
        return detail.map(item => {
            if (typeof item === "string") {
                return item;
            }

            if (item && typeof item === "object") {
                const field = Array.isArray(item.loc)
                    ? item.loc.filter(x => x !== "body").join(".")
                    : "";

                return field
                    ? `${field}: ${item.msg || "Dữ liệu không hợp lệ"}`
                    : item.msg || JSON.stringify(item);
            }

            return String(item);
        }).join("; ");
    }

    if (detail && typeof detail === "object") {
        return detail.message ||
            detail.msg ||
            JSON.stringify(detail);
    }

    return "Có lỗi xảy ra. Vui lòng thử lại!";
}


// ==========================================
// 5. LAY SAN PHAM TU JSON TINH
// ==========================================

function validateProductCatalog(data) {
    if (!Array.isArray(data)) {
        throw new Error("Dữ liệu sản phẩm không phải danh sách JSON.");
    }

    const productIds = new Set();
    for (const product of data) {
        if (!product || !Number.isSafeInteger(product.id) || product.id <= 0 ||
            typeof product.name !== "string" || !product.name.trim() ||
            typeof product.brand !== "string" ||
            typeof product.category !== "string" ||
            !Number.isSafeInteger(product.price) || product.price <= 0 ||
            !Number.isSafeInteger(product.stock) || product.stock < 0 ||
            typeof product.image !== "string" || !product.image.trim()) {
            throw new Error("Dữ liệu sản phẩm thiếu trường bắt buộc hoặc không hợp lệ.");
        }
        if (productIds.has(product.id)) {
            throw new Error(`Dữ liệu sản phẩm có ID bị trùng: ${product.id}.`);
        }
        productIds.add(product.id);

        const imagePath = product.image.trim().replace(/\\/g, "/");
        if (imagePath.startsWith("/") || imagePath.split("/").includes("..")) {
            throw new Error(`Đường dẫn ảnh không an toàn cho sản phẩm #${product.id}.`);
        }
        const imageUrl = new URL(imagePath, document.baseURI);
        if (imageUrl.origin !== window.location.origin) {
            throw new Error(`Ảnh sản phẩm #${product.id} phải được lưu cùng website.`);
        }
    }

    return data;
}

function getSafeLocalProductImage(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const path = value.trim().replace(/\\/g, "/");
    if (path.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(path) || path.split("/").includes("..")) {
        return "";
    }

    try {
        return new URL(path, document.baseURI).origin === window.location.origin ? path : "";
    } catch {
        return "";
    }
}

async function loadProducts() {
    try {
        productList.innerHTML = `
            <div class="catalog-state" role="status">
                <span class="loading-spinner" aria-hidden="true"></span>
                <p>Đang tải sản phẩm...</p>
            </div>
        `;
        productList.setAttribute("aria-busy", "true");

        const response = await fetch(PRODUCTS_DATA_URL, { cache: "no-cache" });

        if (!response.ok) {
            throw new Error(`Không thể tải danh sách sản phẩm (HTTP ${response.status}).`);
        }

        const staticData = await response.json();
        validateProductCatalog(staticData);
        let data = staticData;

        if (API_BASE_URL) {
            try {
                const liveResponse = await fetch(apiUrl("/api/products"), { cache: "no-store" });
                if (!liveResponse.ok) {
                    throw new Error(`Worker trả về HTTP ${liveResponse.status}.`);
                }
                const liveData = await liveResponse.json();
                if (!Array.isArray(liveData)) {
                    throw new Error("Worker trả về danh mục không hợp lệ.");
                }
                const staticById = new Map(staticData.map(product => [product.id, product]));
                data = liveData.map(product => ({
                    ...product,
                    image: staticById.get(Number(product.id))?.image ||
                        getSafeLocalProductImage(product.image) ||
                        IMAGE_MANIFEST.products?.[String(product.id)]?.imagePath ||
                        DEFAULT_IMAGE_FALLBACK
                }));
                validateProductCatalog(data);
                console.info(`Đã đồng bộ ${data.length} sản phẩm và tồn kho từ Worker.`);
            } catch (error) {
                console.warn("Không thể đồng bộ dữ liệu trực tiếp từ Worker; đang dùng danh mục tĩnh.", error);
                data = staticData;
            }
        }

        products = data.filter(product => product && product.is_active !== false);

        cart = cart.filter(item =>
            products.some(product => product.id === item.id)
        );

        populateBrandFilter();
        renderBrandShowcaseCounts();
        renderProductShelves();
        renderProducts();
        renderCart();

        console.info(`Đã tải ${products.length} sản phẩm.`);

    } catch (error) {
        console.error("Lỗi tải sản phẩm:", error);

        productList.innerHTML = `
            <div class="catalog-state catalog-error" role="alert">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <p>Không thể tải dữ liệu sản phẩm. Hãy kiểm tra data/products.json và thử lại.</p>
                <button class="secondary-button retry-products" type="button">Thử tải lại</button>
            </div>
        `;
    } finally {
        productList.setAttribute("aria-busy", "false");
    }
}


// ==========================================
// 6. HIEN THI SAN PHAM
// ==========================================

function getProductPrice(product) {
    const price = Number(product.price);
    const salePrice = Number(product.sale_price);

    return Number.isFinite(salePrice) && salePrice > 0 && salePrice < price
        ? salePrice
        : price;
}

function hasValidSalePrice(product) {
    const price = Number(product.price);
    const salePrice = Number(product.sale_price);

    return Number.isFinite(price) &&
        Number.isFinite(salePrice) &&
        salePrice > 0 &&
        salePrice < price;
}

function getDiscountPercent(product) {
    if (!hasValidSalePrice(product)) return 0;
    return Math.round((Number(product.price) - Number(product.sale_price)) / Number(product.price) * 100);
}

function getProductStock(product) {
    const stock = Number(product.stock);
    return Number.isFinite(stock) ? Math.max(0, stock) : 0;
}

function getDisplayBadge(product) {
    if (hasValidSalePrice(product)) {
        return `Giảm ${getDiscountPercent(product)}%`;
    }

    return product.badge === "Gaming" ? "Gaming" : "";
}

function renderProductCard(product) {
    const productId = Number(product.id);
    const stock = getProductStock(product);
    const onSale = hasValidSalePrice(product);
    const badge = getDisplayBadge(product);

    return `
        <article class="product-card">
            <div class="product-image">
                ${badge ? `<span class="product-badge">${escapeHTML(badge)}</span>` : ""}
                ${renderProductImage(product.id, product.name, "", product.image)}
            </div>
            <div class="product-info">
                <span class="product-category">${escapeHTML(getCategoryName(product.category))}</span>
                <span class="product-brand">${renderBrandLabel(product.brand)}</span>
                <h3 title="${escapeHTML(product.name)}">${escapeHTML(product.name)}</h3>
                <div class="product-price-row">
                    <strong class="product-price">${formatPrice(getProductPrice(product))}</strong>
                    ${onSale ? `
                        <del class="product-original-price">${formatPrice(Number(product.price))}</del>
                        <span class="product-discount">-${getDiscountPercent(product)}%</span>
                    ` : ""}
                </div>
                <p class="product-stock ${stock > 0 ? "" : "out-of-stock"}">
                    ${stock > 0 ? `Còn hàng · ${stock} sản phẩm` : "Tạm hết hàng"}
                </p>
                <div class="product-card-actions">
                    <button class="product-details-button" type="button" data-product-action="details" data-id="${productId}">
                        Chi tiết
                    </button>
                    <button class="add-cart" type="button" data-product-action="add" data-id="${productId}" ${stock > 0 ? "" : "disabled"}>
                        <i class="fa-solid fa-cart-plus" aria-hidden="true"></i>
                        ${stock > 0 ? "Thêm vào giỏ" : "Hết hàng"}
                    </button>
                </div>
            </div>
        </article>
    `;
}

function populateBrandFilter() {
    const brands = [...new Set(products.map(product => product.brand || "Chưa xác định"))]
        .sort((left, right) => left.localeCompare(right, "vi"));
    const selectedBrand = currentBrand;

    brandFilter.innerHTML = `
        <option value="">Tất cả thương hiệu</option>
        ${brands.map(brand => `<option value="${escapeHTML(brand)}">${escapeHTML(brand)}</option>`).join("")}
    `;
    brandFilter.value = selectedBrand;
}

function renderBrandShowcaseCounts() {
    document.querySelectorAll("[data-brand-count]").forEach(element => {
        const brand = element.dataset.brandCount;
        const count = products.filter(product => product.brand === brand).length;
        element.textContent = `${count} sản phẩm`;
    });

    document.querySelectorAll(".brand-card").forEach(button => {
        const isActive = button.dataset.brand === currentBrand;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}

function renderProductShelves() {
    const recommendationsSection = document.getElementById("recommendations-section");
    const newArrivalsSection = document.getElementById("new-arrivals-section");
    const promotionsSection = document.getElementById("promotions-section");

    recommendationsSection.hidden = products.length === 0;
    const recommendations = SHOWCASE_BRANDS
        .map(brand => products.find(product => product.brand === brand))
        .filter(Boolean);
    document.getElementById("recommended-products").innerHTML =
        recommendations.map(renderProductCard).join("");

    const newArrivals = [...products]
        .sort((left, right) => Number(right.id) - Number(left.id))
        .slice(0, 4);
    newArrivalsSection.hidden = newArrivals.length === 0;
    document.getElementById("new-arrivals-products").innerHTML =
        newArrivals.map(renderProductCard).join("");

    const promotions = products.filter(hasValidSalePrice);
    promotionsSection.hidden = promotions.length === 0;
    document.getElementById("promotion-products").innerHTML =
        promotions.map(renderProductCard).join("");
}

function getFilteredProducts() {
    const minPrice = priceMinInput.value === "" ? null : Number(priceMinInput.value);
    const maxPrice = priceMaxInput.value === "" ? null : Number(priceMaxInput.value);
    const invalidPriceRange = minPrice !== null &&
        maxPrice !== null &&
        minPrice > maxPrice;

    if (invalidPriceRange) {
        return { products: [], invalidPriceRange: true };
    }

    const filteredProducts = products.filter(product => {
        const name = String(product.name || "").toLocaleLowerCase("vi");
        const productBrand = product.brand || "Chưa xác định";
        const price = getProductPrice(product);
        const stock = getProductStock(product);

        return (!currentBrand || productBrand === currentBrand) &&
            (currentCategory === "all" || product.category === currentCategory) &&
            (!searchKeyword || name.includes(searchKeyword)) &&
            (minPrice === null || price >= minPrice) &&
            (maxPrice === null || price <= maxPrice) &&
            (stockFilter.value !== "in-stock" || stock > 0) &&
            (stockFilter.value !== "out-of-stock" || stock === 0);
    });

    if (sortSelect.value === "low") {
        filteredProducts.sort((left, right) => getProductPrice(left) - getProductPrice(right));
    } else if (sortSelect.value === "high") {
        filteredProducts.sort((left, right) => getProductPrice(right) - getProductPrice(left));
    } else if (sortSelect.value === "name") {
        filteredProducts.sort((left, right) => left.name.localeCompare(right.name, "vi"));
    }

    return { products: filteredProducts, invalidPriceRange: false };
}

function renderProducts() {
    const { products: filteredProducts, invalidPriceRange } = getFilteredProducts();
    const visibleProducts = filteredProducts.slice(0, visibleProductCount);
    const emptyMessage = document.getElementById("empty-message");
    const emptyMessageText = emptyMessage.querySelector("p");
    const clearFiltersButton = document.getElementById("clear-filters");
    const filterIsActive = Boolean(
        currentBrand ||
        currentCategory !== "all" ||
        searchKeyword ||
        priceMinInput.value ||
        priceMaxInput.value ||
        stockFilter.value ||
        sortSelect.value !== "default"
    );

    document.getElementById("product-section-title").textContent =
        currentBrand ? `Sản phẩm ${currentBrand}` : "Tất cả sản phẩm";
    document.getElementById("brand-filter-status").hidden = !currentBrand;
    document.getElementById("brand-filter-status").textContent = currentBrand
        ? `Đang lọc thương hiệu ${currentBrand} · ${filteredProducts.length} sản phẩm phù hợp với các bộ lọc hiện tại.`
        : "";
    document.getElementById("product-results-count").textContent = invalidPriceRange
        ? "Giá tối thiểu phải nhỏ hơn hoặc bằng giá tối đa."
        : `Hiển thị ${visibleProducts.length} / ${filteredProducts.length} sản phẩm`;
    clearFiltersButton.hidden = !filterIsActive;
    emptyMessage.hidden = filteredProducts.length !== 0;
    emptyMessageText.textContent = invalidPriceRange
        ? "Khoảng giá chưa hợp lệ."
        : "Chưa tìm thấy sản phẩm phù hợp với lựa chọn này.";
    document.getElementById("load-more-products").hidden =
        invalidPriceRange || visibleProducts.length >= filteredProducts.length;

    productList.innerHTML = visibleProducts.map(renderProductCard).join("");
    renderBrandShowcaseCounts();
}

function renderFilteredProducts() {
    visibleProductCount = 12;
    renderProducts();
}


function getCategoryName(category) {
    const categories = {
        phone: "Điện thoại / Máy tính bảng",
        laptop: "Laptop",
        audio: "Âm thanh",
        accessory: "Phụ kiện"
    };

    return categories[category] || "Sản phẩm";
}


// ==========================================
// 7. TIM KIEM SAN PHAM
// ==========================================

searchInput.addEventListener("input", function () {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        searchKeyword = this.value.trim().toLocaleLowerCase("vi");
        renderFilteredProducts();
        if (searchKeyword) trackAnalytics("search", { term: this.value.trim().slice(0, 80) });
    }, 220);
});

document.getElementById("search-toggle").addEventListener("click", () => {
    searchInput.focus();
    searchInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
});


// ==========================================
// 8. LOC DANH MUC
// ==========================================

document.querySelectorAll(".category-card").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll(".category-card").forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");
        currentCategory = button.dataset.category;

        renderFilteredProducts();
    });
});

document.querySelectorAll(".brand-card").forEach(button => {
    button.addEventListener("click", () => {
        currentBrand = button.dataset.brand;
        brandFilter.value = currentBrand;
        renderFilteredProducts();
        document.getElementById("products").scrollIntoView({ behavior: "smooth" });
    });
});

brandFilter.addEventListener("change", () => {
    currentBrand = brandFilter.value;
    renderFilteredProducts();
});

stockFilter.addEventListener("change", renderFilteredProducts);
priceMinInput.addEventListener("input", renderFilteredProducts);
priceMaxInput.addEventListener("input", renderFilteredProducts);
sortSelect.addEventListener("change", renderFilteredProducts);

function clearProductFilters() {
    clearTimeout(searchDebounceTimer);
    currentBrand = "";
    currentCategory = "all";
    searchKeyword = "";
    searchInput.value = "";
    brandFilter.value = "";
    priceMinInput.value = "";
    priceMaxInput.value = "";
    stockFilter.value = "";
    sortSelect.value = "default";
    document.querySelectorAll(".category-card").forEach(button => {
        button.classList.toggle("active", button.dataset.category === "all");
    });
    renderFilteredProducts();
}

document.getElementById("clear-filters").addEventListener("click", clearProductFilters);
document.getElementById("clear-filters-empty").addEventListener("click", clearProductFilters);
document.getElementById("load-more-products").addEventListener("click", () => {
    visibleProductCount += 12;
    renderProducts();
});

// ==========================================
// 9. SAP XEP SAN PHAM
// ==========================================

sortSelect.addEventListener("change", renderProducts);


// ==========================================
// 10. LUU GIO HANG
// ==========================================

function saveCart() {
    localStorage.setItem("hoangdz_cart", JSON.stringify(cart));
}


// ==========================================
// 11. THEM SAN PHAM VAO GIO
// ==========================================

function addToCart(id) {
    const product = products.find(item => item.id === id);

    if (!product) return;

    const stock = getProductStock(product);
    if (stock <= 0) {
        showToast("Sản phẩm hiện đã hết hàng.");
        return;
    }

    const existingItem = cart.find(item => item.id === id);

    if (existingItem) {
        if (existingItem.quantity >= Math.min(100, stock)) {
            showToast(`Chỉ còn ${stock} sản phẩm trong kho.`);
            return;
        }

        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            quantity: 1
        });
    }

    saveCart();
    renderCart();

    trackAnalytics("add_to_cart", { product_id: Number(product.id), quantity: 1 });
    showToast("Đã thêm " + product.name + " vào giỏ hàng!");
}

document.addEventListener("click", event => {
    const retryButton = event.target.closest(".retry-products");
    if (retryButton) {
        loadProducts();
        return;
    }

    const button = event.target.closest("[data-product-action]");
    if (!button) return;

    const productId = Number(button.dataset.id);
    if (button.dataset.productAction === "add") {
        addToCart(productId);
    } else if (button.dataset.productAction === "details") {
        openProductDetails(productId);
    }
});

function openProductDetails(productId) {
    const product = products.find(item => Number(item.id) === productId);
    if (!product) return;
    trackAnalytics("product_view", { product_id: productId });

    const specifications = product.specifications &&
        typeof product.specifications === "object" &&
        !Array.isArray(product.specifications)
        ? Object.entries(product.specifications)
        : [];
    const stock = getProductStock(product);
    const onSale = hasValidSalePrice(product);

    productDetailContent.innerHTML = `
        <div class="product-detail-content">
            <div class="product-detail-image">
                ${renderProductImage(product.id, product.name, "", product.image)}
            </div>
            <div class="product-detail-copy">
                <span class="product-category">${escapeHTML(getCategoryName(product.category))}</span>
                <p class="product-brand">${renderBrandLabel(product.brand)}</p>
                <h2 id="product-detail-title">${escapeHTML(product.name)}</h2>
                <div class="product-price-row">
                    <strong class="product-price">${formatPrice(getProductPrice(product))}</strong>
                    ${onSale ? `
                        <del class="product-original-price">${formatPrice(Number(product.price))}</del>
                        <span class="product-discount">-${getDiscountPercent(product)}%</span>
                    ` : ""}
                </div>
                <p class="product-stock ${stock > 0 ? "" : "out-of-stock"}">
                    ${stock > 0 ? `Còn hàng · ${stock} sản phẩm` : "Tạm hết hàng"}
                </p>
                <p>${escapeHTML(product.description || "Thông tin sản phẩm đang được cập nhật.")}</p>
                ${specifications.length ? `
                    <h3>Thông số kỹ thuật</h3>
                    <ul class="product-spec-list">
                        ${specifications.map(([key, value]) => `
                            <li>
                                <strong>${escapeHTML(String(key).replace(/_/g, " "))}</strong>
                                <span>${escapeHTML(value)}</span>
                            </li>
                        `).join("")}
                    </ul>
                ` : ""}
                <button class="add-cart" type="button" data-product-action="add" data-id="${Number(product.id)}" ${stock > 0 ? "" : "disabled"}>
                    <i class="fa-solid fa-cart-plus" aria-hidden="true"></i>
                    ${stock > 0 ? "Thêm vào giỏ hàng" : "Hết hàng"}
                </button>
            </div>
        </div>
    `;

    productDetailModal.classList.add("open");
    productDetailModal.setAttribute("aria-hidden", "false");
}

function closeProductDetails() {
    productDetailModal.classList.remove("open");
    productDetailModal.setAttribute("aria-hidden", "true");
}

document.getElementById("product-detail-close").addEventListener("click", closeProductDetails);
productDetailModal.addEventListener("click", event => {
    if (event.target === productDetailModal) {
        closeProductDetails();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && productDetailModal.classList.contains("open")) {
        closeProductDetails();
    }
});


// ==========================================
// 12. HIEN THI GIO HANG
// ==========================================

function renderCart() {
    cartItems.innerHTML = "";

    let total = 0;
    let totalQuantity = 0;

    cart.forEach(item => {
        const product = products.find(p => p.id === item.id);

        if (!product) return;

        const unitPrice = getProductPrice(product);
        total += unitPrice * item.quantity;
        totalQuantity += item.quantity;

        const element = document.createElement("div");
        element.className = "cart-item";

        element.innerHTML = `
            ${renderProductImage(product.id, product.name, "", product.image)}

            <div class="cart-item-info">
                <h4>${escapeHTML(product.name)}</h4>
                <p>
                    ${formatPrice(unitPrice)}
                    ${hasValidSalePrice(product) ? `<del class="cart-original-price">${formatPrice(Number(product.price))}</del>` : ""}
                </p>

                <div class="cart-quantity">
                    <button type="button" data-action="decrease" data-id="${product.id}" aria-label="Giảm số lượng ${escapeHTML(product.name)}">-</button>
                    <span>${item.quantity}</span>
                    <button type="button" data-action="increase" data-id="${product.id}" aria-label="Tăng số lượng ${escapeHTML(product.name)}" ${item.quantity >= Math.min(100, getProductStock(product)) ? "disabled" : ""}>+</button>
                </div>
            </div>

            <button
                type="button"
                class="remove-item"
                data-action="remove"
                data-id="${product.id}"
                aria-label="Xóa ${escapeHTML(product.name)} khỏi giỏ"
            >
                <i class="fa-solid fa-trash"></i>
            </button>
        `;

        cartItems.appendChild(element);
    });

    if (totalQuantity === 0) {
        cartItems.innerHTML = `
            <p style="text-align:center;color:#667085;padding:30px 0">
                Giỏ hàng của bạn đang trống.
            </p>
        `;
    }

    cartTotal.textContent = formatPrice(total);
    cartCount.textContent = totalQuantity;

    saveCart();
}


// ==========================================
// 13. TANG GIAM VA XOA SAN PHAM
// ==========================================

cartItems.addEventListener("click", function (event) {
    const button = event.target.closest("[data-action]");

    if (!button) return;

    const id = Number(button.dataset.id);
    const action = button.dataset.action;

    const item = cart.find(product => product.id === id);

    if (!item) return;

    if (action === "increase") {
        const product = products.find(entry => entry.id === id);
        const stock = product ? getProductStock(product) : 0;
        if (item.quantity >= Math.min(100, stock)) {
            showToast(`Chỉ còn ${stock} sản phẩm trong kho.`);
            return;
        }

        item.quantity++;
    }

    if (action === "decrease") {
        item.quantity--;

        if (item.quantity <= 0) {
            cart = cart.filter(product => product.id !== id);
        }
    }

    if (action === "remove") {
        cart = cart.filter(product => product.id !== id);
    }

    renderCart();
});


// ==========================================
// 14. DONG MO GIO HANG
// ==========================================

document.getElementById("cart-toggle").addEventListener("click", () => {
    cartOverlay.classList.add("open");
});

document.getElementById("cart-close").addEventListener("click", () => {
    cartOverlay.classList.remove("open");
});

cartOverlay.addEventListener("click", event => {
    if (event.target === cartOverlay) {
        cartOverlay.classList.remove("open");
    }
});


// ==========================================
// 15. DANG NHAP TAI KHOAN
// ==========================================

async function loginBeforeCheckout() {
    if (accessToken) {
        const access = await refreshCurrentUser({ notify: false });
        if (access === "authorized") {
            return true;
        }
        if (access === "error") {
            return false;
        }
    }

    return new Promise(resolve => {
        pendingCheckoutAuthResolver = resolve;
        openCustomerAccount("checkout", "login");
    });
}


// ==========================================
// 16. MO FORM THANH TOAN
// ==========================================

document.getElementById("checkout-button").addEventListener("click", async () => {
    if (cart.length === 0) {
        showToast("Vui lòng thêm sản phẩm vào giỏ hàng!");
        return;
    }

    const unavailableItem = cart.find(item => {
        const product = products.find(entry => entry.id === item.id);
        return !product || item.quantity > getProductStock(product);
    });
    if (unavailableItem) {
        showToast("Số lượng trong giỏ vượt quá tồn kho hiện tại.");
        renderCart();
        return;
    }

    cartOverlay.classList.remove("open");

    const loggedIn = await loginBeforeCheckout();

    if (!loggedIn) return;

    const checkoutForm = document.getElementById("checkout-form");
    if (currentUser) {
        const nameField = checkoutForm.elements.namedItem("customer");
        const phoneField = checkoutForm.elements.namedItem("phone");
        const addressField = checkoutForm.elements.namedItem("address");
        if (!nameField.value) nameField.value = currentUser.full_name || "";
        if (!phoneField.value) phoneField.value = currentUser.phone || "";
        if (!addressField.value) addressField.value = currentUser.address || "";
    }

    checkoutModal.classList.add("open");
});


// ==========================================
// 17. DONG FORM THANH TOAN
// ==========================================

document.getElementById("checkout-close").addEventListener("click", () => {
    checkoutModal.classList.remove("open");
});

checkoutModal.addEventListener("click", event => {
    if (event.target === checkoutModal) {
        checkoutModal.classList.remove("open");
    }
});


// ==========================================
// 18. DAT HANG THAT - LUU MYSQL
// ==========================================

document.getElementById("checkout-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (cart.length === 0) {
        showToast("Giỏ hàng đang trống!");
        return;
    }

    if (!accessToken) {
        showToast("Vui lòng đăng nhập lại!");
        return;
    }

    const formData = new FormData(event.target);

    const orderData = {
        recipient_name: String(formData.get("customer") || "").trim(),
        recipient_phone: String(formData.get("phone") || "").trim(),
        shipping_address: String(formData.get("address") || "").trim(),
        payment_method: String(formData.get("payment_method") || "cod"),
        note: "",
        items: cart.map(item => ({
            product_id: Number(item.id),
            quantity: Number(item.quantity)
        }))
    };

    if (
        !orderData.recipient_name ||
        !orderData.recipient_phone ||
        !orderData.shipping_address
    ) {
        showToast("Vui lòng điền đầy đủ thông tin nhận hàng!");
        return;
    }

    const submitButton = event.target.querySelector(
        'button[type="submit"]'
    );

    const originalButtonText = submitButton
        ? submitButton.textContent
        : "";

    try {
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Đang xử lý...";
        }

        checkoutIdempotencyKey ||= crypto.randomUUID();
        const response = await fetch(
            apiUrl("/api/orders/"),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                    "Idempotency-Key": checkoutIdempotencyKey
                },
                body: JSON.stringify(orderData)
            }
        );

        const result = await response.json();

        if (response.status === 401) {
            localStorage.removeItem("hoangdz_token");
            localStorage.removeItem("hoangdz_user");

            accessToken = null;

            showToast("Phiên đăng nhập hết hạn. Hãy đăng nhập lại!");
            return;
        }

        if (!response.ok) {
            if (response.status < 500) checkoutIdempotencyKey = null;
            console.error("Lỗi tạo đơn hàng:", result);

            throw new Error(
                getApiErrorMessage(result.detail)
            );
        }

        // Chi xoa gio hang khi Backend da luu don thanh cong
        cart = [];
        checkoutIdempotencyKey = null;
        renderCart();

        event.target.reset();
        checkoutModal.classList.remove("open");

        showToast(
            `Đặt hàng thành công! Mã đơn hàng: #${result.order_id}`
        );
        trackAnalytics("order_created", { item_count: orderData.items.length });

        console.log("DON HANG DA LUU MYSQL:", result);

    } catch (error) {
        console.error("Lỗi đặt hàng:", error);
        showToast(error.message || "Đặt hàng thất bại!");

    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    }
});


// ==========================================
// 19. DANG XUAT
// ==========================================

function logout() {
    clearAccessToken();
    customerOrdersSection.hidden = true;
    adminOrdersSection.hidden = true;
    customerOrderModal.classList.remove("open");
    adminOrderModal.classList.remove("open");
    customerLoginModal.classList.remove("open");
    showToast("Đã đăng xuất!");
}


// ==========================================
// 20. THONG BAO
// ==========================================

let toastTimer;

function showToast(message) {
    const toast = document.getElementById("toast");

    if (!toast) {
        console.log(message);
        return;
    }

    toast.textContent = String(message);

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}

function appendChatbotMessage(role, text) {
    const message = document.createElement("p");
    message.className = `chatbot-message ${role}`;
    message.textContent = String(text);
    const messages = document.getElementById("chatbot-messages");
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
}

async function loadChatbotStatus() {
    const statusElement = document.getElementById("chatbot-status");
    const input = document.getElementById("chatbot-input");
    const sendButton = document.getElementById("chatbot-send");
    if (!API_BASE_URL) {
        statusElement.textContent = "Chatbot AI chưa được cấu hình và hiện chưa khả dụng.";
        input.disabled = true;
        sendButton.disabled = true;
        return;
    }
    try {
        const response = await fetch(apiUrl("/api/chatbot/status"));
        if (!response.ok) {
            throw new Error(`API trạng thái trả về HTTP ${response.status}`);
        }
        const result = await response.json();
        statusElement.textContent = result.message || "Chưa kết nối AI, đang dùng tìm kiếm và FAQ.";
        const chatAvailable = typeof result.chat_available === "boolean"
            ? result.chat_available
            : result.available === true;
        input.disabled = !chatAvailable;
        sendButton.disabled = !chatAvailable;
    } catch (error) {
        console.error("Không thể kiểm tra trạng thái chatbot:", error);
        statusElement.textContent = "Không kết nối được chatbot. Vui lòng thử lại sau.";
        input.disabled = true;
        sendButton.disabled = true;
    }
}

async function postChatbotRequest(path, payload) {
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(apiUrl(path), {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
    });

    let result;
    try {
        result = await response.json();
    } catch (error) {
        console.error("Phản hồi chatbot không phải JSON hợp lệ:", error);
        throw new Error("Máy chủ trả về phản hồi không hợp lệ.");
    }
    if (!response.ok) {
        throw new Error(getApiErrorMessage(result.detail));
    }
    return result;
}

function formatChatbotOrder(order) {
    const orderStatuses = {
        pending: "Chờ xác nhận",
        confirmed: "Đã xác nhận",
        preparing: "Đang chuẩn bị",
        shipping: "Đang giao",
        delivered: "Đã giao",
        cancelled: "Đã hủy"
    };
    const paymentStatuses = {
        unpaid: "Chưa thanh toán",
        paid: "Đã thanh toán",
        refunded: "Đã hoàn tiền"
    };
    const paymentMethods = {
        cod: "Thanh toán khi nhận hàng (COD)",
        bank_transfer: "Chuyển khoản ngân hàng"
    };
    const items = order.items.map(item =>
        `• ${item.product_name} × ${item.quantity}: ${formatPrice(item.subtotal)}`
    );
    return [
        `Đơn hàng #${order.order_id}`,
        `Trạng thái: ${orderStatuses[order.status] || order.status}`,
        `Thanh toán: ${paymentStatuses[order.payment_status] || order.payment_status} · ${paymentMethods[order.payment_method] || order.payment_method}`,
        `Tổng tiền: ${formatPrice(order.total_amount)}`,
        ...items
    ].join("\n");
}

document.getElementById("chatbot-toggle").addEventListener("click", async () => {
    const panel = document.getElementById("chatbot-panel");
    panel.hidden = !panel.hidden;
    document.getElementById("chatbot-toggle").setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
        await loadChatbotStatus();
        document.getElementById("chatbot-input").focus();
    }
});

document.getElementById("chatbot-close").addEventListener("click", () => {
    document.getElementById("chatbot-panel").hidden = true;
    document.getElementById("chatbot-toggle").setAttribute("aria-expanded", "false");
});

document.getElementById("chatbot-form").addEventListener("submit", async event => {
    event.preventDefault();
    const input = document.getElementById("chatbot-input");
    const sendButton = document.getElementById("chatbot-send");
    const message = input.value.trim();
    if (!message || sendButton.disabled) return;

    appendChatbotMessage("user", message);
    input.value = "";
    sendButton.disabled = true;
    try {
        const result = await postChatbotRequest("/api/chatbot/chat", {
            message
        });
        trackAnalytics("chatbot_interaction", { interaction: "message" });
        appendChatbotMessage("assistant", result.reply);
    } catch (error) {
        console.error("Lỗi gửi tin nhắn chatbot:", error);
        appendChatbotMessage("assistant", error.message || "Không thể gửi tin nhắn.");
    } finally {
        sendButton.disabled = false;
        input.focus();
    }
});

document.getElementById("chatbot-order-toggle").addEventListener("click", () => {
    const form = document.getElementById("chatbot-order-form");
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById("chatbot-order-id").focus();
});

document.getElementById("chatbot-order-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!accessToken) {
        appendChatbotMessage("assistant", "Vui lòng đăng nhập tài khoản của bạn trước khi tra cứu đơn hàng.");
        return;
    }

    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const orderId = Number(document.getElementById("chatbot-order-id").value);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        appendChatbotMessage("assistant", "Mã đơn hàng không hợp lệ.");
        return;
    }

    submitButton.disabled = true;
    try {
        const order = await postChatbotRequest("/api/chatbot/order-lookup", { order_id: orderId });
        trackAnalytics("chatbot_interaction", { interaction: "order_lookup" });
        appendChatbotMessage("assistant", formatChatbotOrder(order));
    } catch (error) {
        console.error("Lỗi tra cứu đơn hàng từ chatbot:", error);
        appendChatbotMessage("assistant", error.message || "Không thể tra cứu đơn hàng.");
    } finally {
        submitButton.disabled = false;
    }
});


function updateAccountToggle() {
    const label = document.getElementById("account-toggle-label");
    const accountName = currentUser && currentUser.full_name
        ? currentUser.full_name
        : "Đăng nhập";

    label.textContent = accountName;
    accountToggle.setAttribute("aria-label", currentUser
        ? `Tài khoản ${accountName}`
        : "Đăng nhập tài khoản");
}

async function refreshCurrentUser({ notify = true } = {}) {
    if (!accessToken) {
        currentUser = null;
        updateAccountToggle();
        return "login";
    }

    try {
        const response = await fetch(apiUrl("/api/auth/me"), {
            headers: { "Authorization": `Bearer ${accessToken}` }
        });

        if (response.status === 401) {
            clearAccessToken();
            return "login";
        }

        const result = await response.json();
        if (!response.ok) {
            throw new Error(getApiErrorMessage(result.detail));
        }

        currentUser = result;
        localStorage.setItem("hoangdz_user", JSON.stringify(result));
        updateAccountToggle();
        return "authorized";
    } catch (error) {
        console.error("Không thể kiểm tra phiên đăng nhập:", error);
        if (notify) {
            showToast(error.message || "Không thể kết nối Backend Worker.");
        }
        return "error";
    }
}

function setAccountAuthMode(mode) {
    const isRegister = mode === "register";
    document.getElementById("account-auth-title").textContent = isRegister
        ? "Tạo tài khoản HOANGDZ STORE"
        : "Đăng nhập tài khoản";
    document.getElementById("customer-login-form").hidden = isRegister;
    document.getElementById("customer-register-form").hidden = !isRegister;
    document.getElementById("customer-login-error").textContent = "";
    document.getElementById("customer-register-error").textContent = "";

    document.querySelectorAll(".account-tab").forEach(tab => {
        const selected = tab.dataset.authMode === mode;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
    });
}

function showAccountProfile() {
    if (!currentUser) {
        setAccountAuthMode("login");
        document.getElementById("account-auth-view").hidden = false;
        document.getElementById("account-profile-view").hidden = true;
        return;
    }

    document.getElementById("account-auth-view").hidden = true;
    document.getElementById("account-profile-view").hidden = false;

    const profileForm = document.getElementById("account-profile-form");
    profileForm.elements.namedItem("full_name").value = currentUser.full_name || "";
    profileForm.elements.namedItem("phone").value = currentUser.phone || "";
    profileForm.elements.namedItem("address").value = currentUser.address || "";
    document.getElementById("account-email").value = currentUser.email || "";
    document.getElementById("account-profile-message").textContent = "";
    document.getElementById("account-profile-message").classList.remove("success");
    document.getElementById("account-password-message").textContent = "";
    document.getElementById("account-password-message").classList.remove("success");
    document.getElementById("account-role-label").textContent =
        currentUser.role === "admin" ? "Quản trị viên" : "Khách hàng";
}

function openCustomerAccount(intent = "profile", mode = "login") {
    accountIntent = intent;
    if (intent === "profile" && currentUser) {
        showAccountProfile();
    } else {
        document.getElementById("account-auth-view").hidden = false;
        document.getElementById("account-profile-view").hidden = true;
        setAccountAuthMode(mode);
    }
    customerLoginModal.classList.add("open");
}

function closeCustomerAccount() {
    customerLoginModal.classList.remove("open");

    if (pendingCheckoutAuthResolver) {
        pendingCheckoutAuthResolver(false);
        pendingCheckoutAuthResolver = null;
    }
}

async function finishCustomerAuthentication() {
    const access = await refreshCurrentUser();
    if (access !== "authorized") {
        throw new Error("Đăng nhập thành công nhưng không thể tải thông tin tài khoản.");
    }

    showToast("Đăng nhập thành công!");
    customerLoginModal.classList.remove("open");

    if (accountIntent === "checkout") {
        const resolveCheckout = pendingCheckoutAuthResolver;
        pendingCheckoutAuthResolver = null;
        if (resolveCheckout) {
            resolveCheckout(true);
        }
        return;
    }

    if (accountIntent === "orders") {
        customerOrdersSection.hidden = false;
        customerOrdersSection.scrollIntoView({ behavior: "smooth" });
        await refreshCustomerOrders();
        return;
    }

    showAccountProfile();
    customerLoginModal.classList.add("open");
}

async function initializeAuth() {
    updateAccountToggle();
    if (accessToken) {
        await refreshCurrentUser({ notify: false });
    }
}


// ==========================================
// 21. LICH SU DON HANG (KHACH HANG)
// ==========================================

async function customerApiRequest(path, options = {}) {
    const headers = {
        ...(options.headers || {}),
        "Authorization": `Bearer ${accessToken}`
    };

    if (options.body) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(apiUrl(path), {
        ...options,
        headers
    });

    let result = {};
    try {
        result = await response.json();
    } catch (error) {
        if (response.ok) {
            throw new Error("Backend trả về dữ liệu không hợp lệ.");
        }
    }

    if (response.status === 401) {
        clearAccessToken();
        customerOrdersSection.hidden = true;
        throw new Error("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
    }

    if (!response.ok) {
        throw new Error(getApiErrorMessage(result.detail));
    }

    return result;
}

async function checkCustomerAccess() {
    return refreshCurrentUser();
}

async function loadCustomerOrders() {
    customerOrdersList.innerHTML = `
        <p class="customer-orders-message">Đang tải đơn hàng...</p>
    `;

    const params = new URLSearchParams({
        page: String(customerOrdersPage),
        page_size: "10"
    });
    const search = document.getElementById("customer-order-search").value.trim();
    const statusFilter = document.getElementById("customer-status-filter").value;

    if (search) params.set("search", search);
    if (statusFilter) params.set("status_filter", statusFilter);

    const result = await customerApiRequest(
        `/api/orders/?${params.toString()}`
    );

    if (result.orders.length === 0) {
        customerOrdersList.innerHTML = `
            <p class="customer-orders-message">Chưa tìm thấy đơn hàng phù hợp.</p>
        `;
    } else {
        customerOrdersList.innerHTML = result.orders.map(order => {
            const statusLabel = adminStatusLabels[order.status] || order.status;
            const paymentLabel = adminPaymentLabels[order.payment_status] || order.payment_status;

            return `
                <article class="customer-order-card">
                    <div class="customer-order-card-header">
                        <div>
                            <strong>Đơn hàng #${Number(order.id)}</strong>
                            <time>${escapeHTML(formatOrderDate(order.created_at))}</time>
                        </div>
                        <span class="admin-status-badge" data-status="${escapeHTML(order.status)}">
                            ${escapeHTML(statusLabel)}
                        </span>
                    </div>
                    <div class="customer-order-items">
                        ${order.items.map(item => `
                            <div class="customer-order-item">
                                ${renderProductImage(item.product_id, item.product_name, "customer-order-image")}
                                <div class="customer-order-item-info">
                                    <strong>${escapeHTML(item.product_name)}</strong>
                                    <span>${Number(item.quantity)} × ${escapeHTML(formatPrice(item.unit_price))}</span>
                                </div>
                            </div>
                        `).join("")}
                    </div>
                    <div class="customer-order-card-footer">
                        <div>
                            <span class="admin-status-badge" data-status="${escapeHTML(order.payment_status)}">
                                ${escapeHTML(paymentLabel)}
                            </span>
                            <strong class="customer-order-card-total">${escapeHTML(formatPrice(order.total_amount))}</strong>
                        </div>
                        <div class="customer-order-actions">
                            <button type="button" data-customer-order-id="${Number(order.id)}">
                                Xem chi tiết
                            </button>
                        </div>
                    </div>
                </article>
            `;
        }).join("");
    }

    const totalPages = Number(result.total_pages || 0);
    const start = result.total === 0 ? 0 : (result.page - 1) * result.page_size + 1;
    const end = Math.min(result.page * result.page_size, result.total);
    document.getElementById("customer-page-summary").textContent =
        `${start}–${end} / ${Number(result.total).toLocaleString("vi-VN")} đơn hàng`;
    document.getElementById("customer-page-prev").disabled = result.page <= 1;
    document.getElementById("customer-page-next").disabled =
        totalPages === 0 || result.page >= totalPages;
}

async function refreshCustomerOrders() {
    try {
        await loadCustomerOrders();
    } catch (error) {
        console.error("Lỗi tải lịch sử đơn hàng:", error);
        customerOrdersList.innerHTML = `
            <p class="customer-orders-message">
                ${escapeHTML(error.message || "Không thể tải lịch sử đơn hàng.")}
            </p>
        `;
        showToast(error.message || "Không thể tải lịch sử đơn hàng.");
    }
}

function renderCustomerOrderDetail(order) {
    const steps = [
        ["pending", "Đã đặt"],
        ["confirmed", "Đã xác nhận"],
        ["preparing", "Đang chuẩn bị"],
        ["shipping", "Đang giao"],
        ["delivered", "Đã giao"]
    ];
    const currentStep = steps.findIndex(([status]) => status === order.status);
    const progress = order.status === "cancelled"
        ? `<p class="customer-cancelled-message">Đơn hàng này đã được hủy.</p>`
        : `<div class="customer-order-progress" aria-label="Tiến trình đơn hàng">
            ${steps.map(([status, label], index) => `
                <div class="customer-progress-step ${
                    index < currentStep ? "is-complete" : ""
                } ${index === currentStep ? "is-current" : ""}">
                    ${label}
                </div>
            `).join("")}
        </div>`;
    const paymentLabel = adminPaymentLabels[order.payment_status] || order.payment_status;
    const paymentMethod = order.payment_method === "bank_transfer"
        ? "Chuyển khoản ngân hàng thủ công"
        : "Thanh toán khi nhận hàng (COD)";

    document.getElementById("customer-order-detail").innerHTML = `
        <div class="customer-detail-heading">
            <div>
                <span class="eyebrow">CHI TIẾT ĐƠN HÀNG</span>
                <h2>Đơn hàng #${Number(order.id)}</h2>
                <p>Đặt lúc ${escapeHTML(formatOrderDate(order.created_at))}</p>
            </div>
            <span class="admin-status-badge" data-status="${escapeHTML(order.status)}">
                ${escapeHTML(adminStatusLabels[order.status] || order.status)}
            </span>
        </div>
        ${progress}
        <div class="customer-detail-grid">
            <section class="customer-detail-card">
                <h3>Địa chỉ nhận hàng</h3>
                <p><strong>${escapeHTML(order.recipient_name)}</strong></p>
                <p>${escapeHTML(order.recipient_phone)}</p>
                <p>${escapeHTML(order.shipping_address)}</p>
            </section>
            <section class="customer-detail-card">
                <h3>Thanh toán</h3>
                <p>${escapeHTML(paymentMethod)}</p>
                <p>Trạng thái: <span class="admin-status-badge" data-status="${escapeHTML(order.payment_status)}">
                    ${escapeHTML(paymentLabel)}
                </span></p>
            </section>
        </div>
        <section class="customer-detail-items">
            <h3>Sản phẩm trong đơn</h3>
            ${order.items.map(item => `
                <div class="customer-detail-item">
                    ${renderProductImage(item.product_id, item.product_name, "customer-order-image")}
                    <div class="customer-detail-item-info">
                        <strong>${escapeHTML(item.product_name)}</strong>
                        <span>${Number(item.quantity)} × ${escapeHTML(formatPrice(item.unit_price))}</span>
                    </div>
                    <strong>${escapeHTML(formatPrice(item.subtotal))}</strong>
                </div>
            `).join("")}
            <div class="customer-detail-total">
                <span>Tổng tiền</span>
                <span>${escapeHTML(formatPrice(order.total_amount))}</span>
            </div>
        </section>
        <section class="customer-detail-card">
            <h3>Ghi chú đơn hàng</h3>
            <p>${order.note ? escapeHTML(order.note) : "Không có ghi chú."}</p>
        </section>
        <div class="customer-invoice-actions">
            ${order.status === "pending"
                ? `<button type="button" class="customer-cancel-order" data-cancel-order="${Number(order.id)}">
                    Hủy đơn hàng
                </button>`
                : ""}
            <button type="button" class="customer-print-invoice">
                <i class="fa-solid fa-print"></i> In hóa đơn
            </button>
        </div>
    `;
}

async function openCustomerOrder(orderId) {
    try {
        const order = await customerApiRequest(`/api/orders/${orderId}`);
        currentCustomerOrder = order;
        renderCustomerOrderDetail(order);
        customerOrderModal.classList.add("open");
    } catch (error) {
        console.error("Lỗi tải chi tiết đơn hàng:", error);
        showToast(error.message || "Không thể tải chi tiết đơn hàng.");
    }
}

document.getElementById("customer-orders-toggle").addEventListener("click", async () => {
    if (!customerOrdersSection.hidden) {
        customerOrdersSection.hidden = true;
        return;
    }

    const access = await checkCustomerAccess();
    if (access === "login") {
        openCustomerAccount("orders", "login");
        return;
    }
    if (access !== "authorized") {
        return;
    }

    customerOrdersSection.hidden = false;
    customerOrdersSection.scrollIntoView({ behavior: "smooth" });
    await refreshCustomerOrders();
});

accountToggle.addEventListener("click", async () => {
    const access = await refreshCurrentUser();

    if (access === "authorized") {
        openCustomerAccount("profile");
    } else if (access === "login") {
        openCustomerAccount("profile", "login");
    }
});

document.getElementById("customer-login-close").addEventListener("click", () => {
    closeCustomerAccount();
});

customerLoginModal.addEventListener("click", event => {
    if (event.target === customerLoginModal) {
        closeCustomerAccount();
        return;
    }

    const passwordToggle = event.target.closest("[data-password-target]");
    if (passwordToggle) {
        const passwordInput = document.getElementById(
            passwordToggle.dataset.passwordTarget
        );
        const showPassword = passwordInput.type === "password";
        passwordInput.type = showPassword ? "text" : "password";
        passwordToggle.textContent = showPassword ? "Ẩn" : "Hiện";
        passwordToggle.setAttribute(
            "aria-label",
            showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
        );
    }
});

document.querySelectorAll(".account-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        setAccountAuthMode(tab.dataset.authMode);
    });
});

document.getElementById("customer-login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const errorElement = document.getElementById("customer-login-error");
    errorElement.textContent = "";
    errorElement.classList.remove("success");
    submitButton.disabled = true;

    try {
        const formData = new FormData(form);
        const response = await fetch(apiUrl("/api/auth/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: String(formData.get("email") || "").trim(),
                password: String(formData.get("password") || "")
            })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(getApiErrorMessage(result.detail));
        }

        if (!result.access_token || !result.user) {
            throw new Error("Backend không trả về thông tin đăng nhập hợp lệ.");
        }

        accessToken = result.access_token;
        localStorage.setItem("hoangdz_token", accessToken);
        localStorage.setItem("hoangdz_user", JSON.stringify(result.user));
        form.reset();
        await finishCustomerAuthentication();
    } catch (error) {
        console.error("Lỗi đăng nhập tài khoản:", error);
        errorElement.textContent = error.message || "Không thể đăng nhập.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("customer-register-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const errorElement = document.getElementById("customer-register-error");
    errorElement.textContent = "";
    errorElement.classList.remove("success");
    submitButton.disabled = true;

    try {
        const formData = new FormData(form);
        const password = String(formData.get("password") || "");
        const confirmPassword = String(formData.get("confirm_password") || "");

        if (password !== confirmPassword) {
            throw new Error("Mật khẩu xác nhận không khớp.");
        }

        const email = String(formData.get("email") || "").trim();
        const response = await fetch(apiUrl("/api/auth/register"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                full_name: String(formData.get("full_name") || "").trim(),
                email,
                phone: String(formData.get("phone") || "").trim() || null,
                password
            })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(getApiErrorMessage(result.detail));
        }

        form.reset();
        document.querySelector('#customer-login-form [name="email"]').value = email;
        setAccountAuthMode("login");
        const loginMessage = document.getElementById("customer-login-error");
        loginMessage.textContent = "Tạo tài khoản thành công. Vui lòng đăng nhập.";
        loginMessage.classList.add("success");
    } catch (error) {
        console.error("Lỗi tạo tài khoản:", error);
        errorElement.textContent = error.message || "Không thể tạo tài khoản.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("account-profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const message = document.getElementById("account-profile-message");
    message.textContent = "";
    message.classList.remove("success");
    submitButton.disabled = true;

    try {
        const formData = new FormData(form);
        const result = await customerApiRequest("/api/auth/me", {
            method: "PUT",
            body: JSON.stringify({
                full_name: String(formData.get("full_name") || "").trim(),
                phone: String(formData.get("phone") || "").trim() || null,
                address: String(formData.get("address") || "").trim() || null
            })
        });
        currentUser = result;
        localStorage.setItem("hoangdz_user", JSON.stringify(result));
        updateAccountToggle();
        showAccountProfile();
        const successMessage = document.getElementById("account-profile-message");
        successMessage.textContent = "Đã cập nhật thông tin tài khoản.";
        successMessage.classList.add("success");
    } catch (error) {
        console.error("Lỗi cập nhật thông tin tài khoản:", error);
        message.textContent = error.message || "Không thể cập nhật thông tin.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("account-password-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const message = document.getElementById("account-password-message");
    message.textContent = "";
    message.classList.remove("success");
    submitButton.disabled = true;

    try {
        const formData = new FormData(form);
        const newPassword = String(formData.get("new_password") || "");
        const confirmPassword = String(formData.get("confirm_password") || "");

        if (newPassword !== confirmPassword) {
            throw new Error("Mật khẩu mới xác nhận không khớp.");
        }

        await customerApiRequest("/api/auth/password", {
            method: "PATCH",
            body: JSON.stringify({
                current_password: String(formData.get("current_password") || ""),
                new_password: newPassword
            })
        });
        form.reset();
        message.textContent = "Đã đổi mật khẩu thành công.";
        message.classList.add("success");
    } catch (error) {
        console.error("Lỗi đổi mật khẩu:", error);
        message.textContent = error.message || "Không thể đổi mật khẩu.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("account-logout").addEventListener("click", logout);

document.getElementById("customer-orders-refresh").addEventListener("click", refreshCustomerOrders);

document.getElementById("customer-orders-filters").addEventListener("submit", event => {
    event.preventDefault();
    customerOrdersPage = 1;
    refreshCustomerOrders();
});

document.getElementById("customer-status-filter").addEventListener("change", () => {
    customerOrdersPage = 1;
    refreshCustomerOrders();
});

document.getElementById("customer-page-prev").addEventListener("click", () => {
    if (customerOrdersPage > 1) {
        customerOrdersPage--;
        refreshCustomerOrders();
    }
});

document.getElementById("customer-page-next").addEventListener("click", () => {
    customerOrdersPage++;
    refreshCustomerOrders();
});

customerOrdersList.addEventListener("click", event => {
    const button = event.target.closest("[data-customer-order-id]");
    if (button) {
        openCustomerOrder(Number(button.dataset.customerOrderId));
    }
});

document.getElementById("customer-order-close").addEventListener("click", () => {
    customerOrderModal.classList.remove("open");
});

customerOrderModal.addEventListener("click", event => {
    if (event.target === customerOrderModal) {
        customerOrderModal.classList.remove("open");
    }
});

document.getElementById("customer-order-detail").addEventListener("click", async event => {
    const printButton = event.target.closest(".customer-print-invoice");
    if (printButton) {
        window.print();
        return;
    }

    const cancelButton = event.target.closest("[data-cancel-order]");
    if (!cancelButton || !currentCustomerOrder) {
        return;
    }

    if (!window.confirm(`Bạn có chắc muốn hủy đơn hàng #${currentCustomerOrder.id}?`)) {
        return;
    }

    cancelButton.disabled = true;
    try {
        await customerApiRequest(
            `/api/orders/${currentCustomerOrder.id}/cancel`,
            {
                method: "PATCH",
                body: JSON.stringify({ reason: "" })
            }
        );
        showToast("Đã hủy đơn hàng.");
        await Promise.all([
            openCustomerOrder(currentCustomerOrder.id),
            refreshCustomerOrders()
        ]);
    } catch (error) {
        console.error("Lỗi hủy đơn hàng:", error);
        showToast(error.message || "Không thể hủy đơn hàng.");
        cancelButton.disabled = false;
    }
});


// ==========================================
// 22. QUAN LY DON HANG (ADMIN)
// ==========================================

const adminStatusLabels = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    preparing: "Đang chuẩn bị",
    shipping: "Đang giao",
    delivered: "Đã giao",
    cancelled: "Đã hủy"
};

const adminPaymentLabels = {
    unpaid: "Chưa thanh toán",
    paid: "Đã thanh toán",
    refunded: "Đã hoàn tiền"
};

const adminStatusTransitions = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["shipping", "cancelled"],
    shipping: ["delivered", "cancelled"],
    delivered: [],
    cancelled: []
};

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function getProductImageRecord(productId) {
    const records = IMAGE_MANIFEST.products || {};
    return records[String(Number(productId))] || null;
}

function renderProductImage(productId, productName, className = "", productImagePath = "") {
    const numericId = Number(productId);
    const entry = getProductImageRecord(numericId);
    const imagePath = entry
        ? entry.imagePath
        : productImagePath || DEFAULT_IMAGE_FALLBACK;
    const altSuffix = entry && entry.imageType === "placeholder"
        ? " - ảnh minh họa"
        : "";
    const classAttribute = className
        ? ` class="${escapeHTML(className)}"`
        : "";
    const idAttribute = Number.isInteger(numericId) && numericId > 0
        ? String(numericId)
        : "";

    return `
        <img${classAttribute}
            data-product-image="true"
            data-product-image-id="${idAttribute}"
            src="${escapeHTML(imagePath)}"
            alt="${escapeHTML(`${productName || "Sản phẩm"}${altSuffix}`)}"
            loading="lazy"
        >
    `;
}

function renderBrandLabel(brand) {
    const label = brand || "Chưa xác định";
    const logo = (IMAGE_MANIFEST.brands || {})[label];
    const logoImage = logo
        ? `<img class="product-brand-logo" data-brand-logo="true" src="${escapeHTML(logo.path)}" alt="" aria-hidden="true">`
        : "";

    return `${logoImage}${escapeHTML(label)}`;
}

function renderImageCredits() {
    const creditsContainer = document.getElementById("image-credits");
    const records = Object.values(IMAGE_MANIFEST.products || {})
        .filter(record => record.attributionRequired && record.attributionText);

    if (!creditsContainer || records.length === 0) return;

    creditsContainer.innerHTML = records.map(record => `
        <p>
            Ảnh ${escapeHTML(record.productName)} (${escapeHTML(record.imageVariant || "model")}) —
            <a href="${escapeHTML(record.sourcePageUrl)}" target="_blank" rel="noopener noreferrer">
                ${escapeHTML(record.attributionName || record.imageOwner || "Tác giả")} / Wikimedia Commons
            </a>,
            <a href="${escapeHTML(record.licenseUrl)}" target="_blank" rel="noopener noreferrer">
                ${escapeHTML(record.license)}
            </a>.
            Đã chuyển sang WebP; ảnh PNG nguồn được lưu nội bộ.
        </p>
    `).join("");
    creditsContainer.hidden = false;
}

renderImageCredits();

document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;

    if (image.dataset.brandLogo) {
        image.hidden = true;
        return;
    }

    if (image.dataset.productImage !== "true" || image.dataset.imageFallback === "true") {
        return;
    }

    const entry = getProductImageRecord(image.dataset.productImageId);
    image.dataset.imageFallback = "true";
    image.src = entry ? entry.fallbackPath : DEFAULT_IMAGE_FALLBACK;
}, true);

function formatOrderDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function clearAccessToken() {
    localStorage.removeItem("hoangdz_token");
    localStorage.removeItem("hoangdz_user");
    accessToken = null;
    currentUser = null;
    updateAccountToggle();
}

async function checkAdminAccess() {
    if (!accessToken) {
        return "login";
    }

    try {
        const response = await fetch(apiUrl("/api/auth/me"), {
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        });

        if (response.status === 401) {
            clearAccessToken();
            return "login";
        }

        const result = await response.json();

        if (!response.ok) {
            throw new Error(getApiErrorMessage(result.detail));
        }

        currentUser = result;
        localStorage.setItem("hoangdz_user", JSON.stringify(result));
        updateAccountToggle();

        if (result.role !== "admin") {
            return "denied";
        }

        return "authorized";
    } catch (error) {
        console.error("Không thể xác thực quyền quản trị:", error);
        showToast(error.message || "Không thể kết nối Backend!");
        return "error";
    }
}

async function adminApiRequest(path, options = {}) {
    const headers = {
        ...(options.headers || {}),
        "Authorization": `Bearer ${accessToken}`
    };

    if (options.body) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(apiUrl(path), {
        ...options,
        headers
    });

    let result = {};
    try {
        result = await response.json();
    } catch (error) {
        if (response.ok) {
            throw new Error("Backend trả về dữ liệu không hợp lệ.");
        }
    }

    if (response.status === 401) {
        clearAccessToken();
        adminOrdersSection.hidden = true;
        throw new Error("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
    }

    if (!response.ok) {
        throw new Error(getApiErrorMessage(result.detail));
    }

    return result;
}

async function loadAdminSummary() {
    const summary = await adminApiRequest("/api/orders/admin/summary");

    document.getElementById("admin-stat-total").textContent =
        Number(summary.total_orders || 0).toLocaleString("vi-VN");
    document.getElementById("admin-stat-pending").textContent =
        Number(summary.pending_orders || 0).toLocaleString("vi-VN");
    document.getElementById("admin-stat-active").textContent =
        Number(summary.active_orders || 0).toLocaleString("vi-VN");
    document.getElementById("admin-stat-delivered").textContent =
        Number(summary.delivered_orders || 0).toLocaleString("vi-VN");
    document.getElementById("admin-stat-revenue").textContent =
        formatPrice(summary.revenue_total || 0);
}

async function loadAdminOrders() {
    adminOrdersBody.innerHTML = `
        <tr><td colspan="7" class="admin-table-message">Đang tải đơn hàng...</td></tr>
    `;

    const params = new URLSearchParams({
        page: String(adminOrdersPage),
        page_size: String(adminOrdersPageSize)
    });
    const search = document.getElementById("admin-order-search").value.trim();
    const statusFilter = document.getElementById("admin-status-filter").value;
    const paymentFilter = document.getElementById("admin-payment-filter").value;

    if (search) params.set("search", search);
    if (statusFilter) params.set("status_filter", statusFilter);
    if (paymentFilter) params.set("payment_status_filter", paymentFilter);

    const result = await adminApiRequest(
        `/api/orders/admin/all?${params.toString()}`
    );

    if (result.orders.length === 0) {
        adminOrdersBody.innerHTML = `
            <tr><td colspan="7" class="admin-table-message">
                Không tìm thấy đơn hàng phù hợp.
            </td></tr>
        `;
    } else {
        adminOrdersBody.innerHTML = result.orders.map(order => {
            const statusLabel = adminStatusLabels[order.status] || order.status;
            const paymentLabel = adminPaymentLabels[order.payment_status] || order.payment_status;

            return `
                <tr>
                    <td><span class="admin-order-id">#${Number(order.id)}</span></td>
                    <td>
                        <span class="admin-customer-name">${escapeHTML(order.recipient_name)}</span>
                        <span class="admin-customer-email">${escapeHTML(order.user_email)}</span>
                    </td>
                    <td>${escapeHTML(formatOrderDate(order.created_at))}</td>
                    <td>
                        <span class="admin-status-badge" data-status="${escapeHTML(order.payment_status)}">
                            ${escapeHTML(paymentLabel)}
                        </span>
                    </td>
                    <td>
                        <span class="admin-status-badge" data-status="${escapeHTML(order.status)}">
                            ${escapeHTML(statusLabel)}
                        </span>
                    </td>
                    <td class="numeric-cell">${escapeHTML(formatPrice(order.total_amount))}</td>
                    <td>
                        <button class="admin-open-order" type="button" data-order-id="${Number(order.id)}">
                            Chi tiết
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    const totalPages = Number(result.total_pages || 0);
    const start = result.total === 0 ? 0 : (result.page - 1) * result.page_size + 1;
    const end = Math.min(result.page * result.page_size, result.total);

    document.getElementById("admin-page-summary").textContent =
        `${start}–${end} / ${Number(result.total).toLocaleString("vi-VN")} đơn hàng`;
    document.getElementById("admin-page-prev").disabled = result.page <= 1;
    document.getElementById("admin-page-next").disabled =
        totalPages === 0 || result.page >= totalPages;
}

async function loadAdminProducts() {
    adminProductsBody.innerHTML = `
        <tr><td colspan="7" class="admin-table-message">Đang tải sản phẩm...</td></tr>
    `;

    const params = new URLSearchParams({
        page: String(adminProductsPage),
        page_size: "20"
    });
    const search = document.getElementById("admin-product-search").value.trim();
    const active = document.getElementById("admin-product-active-filter").value;
    if (search) params.set("search", search);
    if (active) params.set("active", active);

    try {
        const result = await adminApiRequest(`/api/admin/products?${params.toString()}`);
        adminProductsTotalPages = Number(result.total_pages || 0);
        adminProductCache.clear();
        result.items.forEach(product => adminProductCache.set(Number(product.id), product));

        if (result.items.length === 0) {
            adminProductsBody.innerHTML = `
                <tr><td colspan="7" class="admin-table-message">Không tìm thấy sản phẩm.</td></tr>
            `;
        } else {
            adminProductsBody.innerHTML = result.items.map(product => `
                <tr>
                    <td>${Number(product.id)}</td>
                    <td>${escapeHTML(product.name)}</td>
                    <td>${escapeHTML(product.brand)}</td>
                    <td class="numeric-cell">${escapeHTML(formatPrice(product.sale_price || product.price))}</td>
                    <td class="numeric-cell">${Number(product.stock)}</td>
                    <td>
                        <span class="admin-status-badge" data-status="${product.is_active ? "delivered" : "cancelled"}">
                            ${product.is_active ? "Đang hiển thị" : "Đang ẩn"}
                        </span>
                    </td>
                    <td class="admin-management-row-actions">
                        <button class="admin-open-order" type="button" data-admin-product-edit="${Number(product.id)}">Sửa</button>
                        <button class="admin-open-order" type="button" data-admin-product-visibility="${Number(product.id)}" data-active="${Boolean(product.is_active)}">
                            ${product.is_active ? "Ẩn" : "Hiện"}
                        </button>
                    </td>
                </tr>
            `).join("");
        }

        const start = result.total === 0 ? 0 : (result.page - 1) * result.page_size + 1;
        const end = Math.min(result.page * result.page_size, result.total);
        document.getElementById("admin-products-page-summary").textContent =
            `${start}–${end} / ${Number(result.total).toLocaleString("vi-VN")} sản phẩm`;
        document.getElementById("admin-products-page-prev").disabled = result.page <= 1;
        document.getElementById("admin-products-page-next").disabled =
            adminProductsTotalPages === 0 || result.page >= adminProductsTotalPages;
    } catch (error) {
        adminProductsBody.innerHTML = `
            <tr><td colspan="7" class="admin-table-message">${escapeHTML(error.message || "Không thể tải sản phẩm.")}</td></tr>
        `;
        throw error;
    }
}

async function loadAdminCustomers() {
    adminCustomersBody.innerHTML = `
        <tr><td colspan="6" class="admin-table-message">Đang tải khách hàng...</td></tr>
    `;

    const params = new URLSearchParams({
        page: String(adminCustomersPage),
        page_size: "20"
    });
    const search = document.getElementById("admin-customer-search").value.trim();
    if (search) params.set("search", search);

    try {
        const result = await adminApiRequest(`/api/admin/customers?${params.toString()}`);
        adminCustomersTotalPages = Number(result.total_pages || 0);

        if (result.items.length === 0) {
            adminCustomersBody.innerHTML = `
                <tr><td colspan="6" class="admin-table-message">Không tìm thấy khách hàng.</td></tr>
            `;
        } else {
            adminCustomersBody.innerHTML = result.items.map(customer => `
                <tr>
                    <td>${Number(customer.id)}</td>
                    <td>${escapeHTML(customer.full_name)}</td>
                    <td>${escapeHTML(customer.email)}</td>
                    <td>${escapeHTML(customer.phone || "—")}</td>
                    <td class="numeric-cell">${Number(customer.order_count)}</td>
                    <td class="admin-management-row-actions">
                        <button class="admin-open-order" type="button" data-admin-customer-edit="${Number(customer.id)}">Chi tiết / sửa</button>
                    </td>
                </tr>
            `).join("");
        }

        const start = result.total === 0 ? 0 : (result.page - 1) * result.page_size + 1;
        const end = Math.min(result.page * result.page_size, result.total);
        document.getElementById("admin-customers-page-summary").textContent =
            `${start}–${end} / ${Number(result.total).toLocaleString("vi-VN")} khách hàng`;
        document.getElementById("admin-customers-page-prev").disabled = result.page <= 1;
        document.getElementById("admin-customers-page-next").disabled =
            adminCustomersTotalPages === 0 || result.page >= adminCustomersTotalPages;
    } catch (error) {
        adminCustomersBody.innerHTML = `
            <tr><td colspan="6" class="admin-table-message">${escapeHTML(error.message || "Không thể tải khách hàng.")}</td></tr>
        `;
        throw error;
    }
}

function getAnalyticsBucket(timestamp, range) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date(timestamp));
    const value = type => parts.find(part => part.type === type)?.value || "00";
    const date = `${value("year")}-${value("month")}-${value("day")}`;
    return range === "24h" ? `${date} ${value("hour")}:00` : date;
}

function renderAnalyticsChart(events, range, ordersByPeriod, rangeStart, rangeEnd) {
    const container = document.getElementById("admin-analytics-chart");
    const groups = new Map();
    const emptyGroup = () => ({
        views: 0,
        users: new Set(),
        products: 0,
        searches: 0,
        carts: 0,
        checkouts: 0,
        orders: 0,
        chatbot: 0
    });
    const start = Date.parse(rangeStart);
    const end = Date.parse(rangeEnd);
    const step = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        for (let timestamp = start; timestamp <= end; timestamp += step) {
            groups.set(getAnalyticsBucket(timestamp, range), emptyGroup());
        }
        groups.set(getAnalyticsBucket(end, range), groups.get(getAnalyticsBucket(end, range)) || emptyGroup());
    }

    events.forEach(event => {
        const key = getAnalyticsBucket(event.timestamp_epoch_ms, range);
        const item = groups.get(key) || emptyGroup();
        item.users.add(event.anonymous_id);
        if (event.event_type === "page_view") item.views++;
        if (event.event_type === "product_view") item.products++;
        if (event.event_type === "search") item.searches++;
        if (event.event_type === "add_to_cart") item.carts++;
        if (event.event_type === "checkout_started") item.checkouts++;
        if (event.event_type === "order_created") item.orders++;
        if (event.event_type === "chatbot_interaction") item.chatbot++;
        groups.set(key, item);
    });

    Object.entries(ordersByPeriod).forEach(([period, count]) => {
        const item = groups.get(period) || emptyGroup();
        item.orders = Number(count);
        groups.set(period, item);
    });

    const entries = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
    container.replaceChildren();
    if (!entries.length) {
        const empty = document.createElement("p");
        empty.textContent = "Không có hoạt động ghi nhận: 0.";
        container.appendChild(empty);
        return;
    }

    if (!entries.some(([, value]) =>
        value.views || value.users.size || value.products || value.searches ||
        value.carts || value.checkouts || value.orders || value.chatbot
    )) {
        const empty = document.createElement("p");
        empty.textContent = "Không có hoạt động ghi nhận: 0.";
        container.appendChild(empty);
    }

    const namespace = "http://www.w3.org/2000/svg";
    const width = 720;
    const height = 220;
    const padding = { top: 16, right: 12, bottom: 34, left: 28 };
    const plotHeight = height - padding.top - padding.bottom;
    const plotWidth = width - padding.left - padding.right;
    const maxValue = Math.max(1, ...entries.flatMap(([, value]) =>
        [value.views, value.users.size, value.products, value.searches, value.carts,
            value.checkouts, value.orders, value.chatbot]
    ));
    const slot = plotWidth / entries.length;
    const series = [
        ["views", "#2563eb", "Truy cập"],
        ["users", "#0891b2", "Người dùng"],
        ["products", "#7c3aed", "Xem sản phẩm"],
        ["searches", "#4f46e5", "Tìm kiếm"],
        ["carts", "#16a34a", "Thêm giỏ"],
        ["checkouts", "#0f766e", "Checkout"],
        ["orders", "#f97316", "Đơn hàng"],
        ["chatbot", "#db2777", "Chatbot"]
    ];
    const gap = Math.min(1, slot / (series.length * 3));
    const barWidth = Math.max(0.25, Math.min(7, (slot * 0.9 - gap * (series.length - 1)) / series.length));
    const groupWidth = series.length * barWidth + (series.length - 1) * gap;
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Lượt truy cập, người dùng, lượt xem sản phẩm, tìm kiếm, thêm giỏ, checkout, đơn hàng và chatbot theo thời gian");

    entries.forEach(([key, values], index) => {
        const group = document.createElementNS(namespace, "g");
        const x = padding.left + index * slot + (slot - groupWidth) / 2;
        const title = document.createElementNS(namespace, "title");
        title.textContent = `${key}: ${values.views} truy cập, ${values.users.size} người hoạt động, ${values.products} lượt xem sản phẩm, ${values.searches} tìm kiếm, ${values.carts} thêm giỏ, ${values.checkouts} checkout, ${values.orders} đơn, ${values.chatbot} chatbot`;
        group.appendChild(title);
        series.forEach(([property, color], seriesIndex) => {
            const value = property === "users" ? values.users.size : values[property];
            const barHeight = value / maxValue * plotHeight;
            const rect = document.createElementNS(namespace, "rect");
            rect.setAttribute("x", String(x + seriesIndex * (barWidth + gap)));
            rect.setAttribute("y", String(padding.top + plotHeight - barHeight));
            rect.setAttribute("width", String(Math.max(0.25, barWidth)));
            rect.setAttribute("height", String(Math.max(0, barHeight)));
            rect.setAttribute("fill", color);
            group.appendChild(rect);
        });
        if (index % Math.max(1, Math.ceil(entries.length / 8)) === 0) {
            const label = document.createElementNS(namespace, "text");
            label.setAttribute("x", String(x + groupWidth / 2));
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("y", String(height - 8));
            label.textContent = range === "24h" ? key.slice(-5) : key.slice(5);
            svg.appendChild(label);
        }
        svg.appendChild(group);
    });
    container.appendChild(svg);
    const legend = document.createElement("ul");
    legend.className = "admin-analytics-legend";
    series.forEach(([, color, label]) => {
        const item = document.createElement("li");
        const swatch = document.createElement("span");
        swatch.setAttribute("aria-hidden", "true");
        swatch.style.backgroundColor = color;
        item.append(swatch, document.createTextNode(label));
        legend.appendChild(item);
    });
    container.appendChild(legend);
}

function renderAdminAnalytics(range) {
    const count = eventType => analyticsEvents.filter(event => event.event_type === eventType).length;
    const pageViews = count("page_view");
    const productViews = count("product_view");
    const cartAdds = count("add_to_cart");
    const checkouts = count("checkout_started");
    const trackedOrders = count("order_created");
    const visitors = new Set(analyticsEvents.map(event => event.anonymous_id));
    const number = value => Number(value).toLocaleString("vi-VN");
    document.getElementById("analytics-page-views").textContent = number(pageViews);
    document.getElementById("analytics-active-users").textContent = number(visitors.size);
    document.getElementById("analytics-product-views").textContent = number(productViews);
    document.getElementById("analytics-searches").textContent = number(count("search"));
    document.getElementById("analytics-cart-adds").textContent = number(cartAdds);
    document.getElementById("analytics-checkouts").textContent = number(checkouts);
    document.getElementById("analytics-orders").textContent = number(analyticsOrdersTotal);
    document.getElementById("analytics-chatbot").textContent = number(count("chatbot_interaction"));
    document.getElementById("analytics-view-cart-rate").textContent =
        `${productViews ? Math.round(cartAdds / productViews * 100) : 0}%`;
    document.getElementById("analytics-cart-order-rate").textContent =
        `${cartAdds ? Math.round(checkouts / cartAdds * 100) : 0}%`;
    document.getElementById("analytics-checkout-order-rate").textContent =
        `${checkouts ? Math.round(analyticsOrdersTotal / checkouts * 100) : 0}%`;

    const productCounts = new Map();
    const searchCounts = new Map();
    analyticsEvents.forEach(event => {
        if (event.event_type === "product_view" && event.product_id) {
            productCounts.set(event.product_id, (productCounts.get(event.product_id) || 0) + 1);
        }
        if (event.event_type === "search" && event.search_term) {
            searchCounts.set(event.search_term, (searchCounts.get(event.search_term) || 0) + 1);
        }
    });
    const productById = new Map(products.map(product => [Number(product.id), product.name]));
    const productList = document.getElementById("admin-analytics-products");
    const searchList = document.getElementById("admin-analytics-search-terms");
    productList.replaceChildren();
    searchList.replaceChildren();
    const appendRanked = (list, rows, label) => {
        if (!rows.length) {
            const item = document.createElement("li");
            item.textContent = "0 lượt";
            list.appendChild(item);
            return;
        }
        rows.slice(0, 5).forEach(([name, value]) => {
            const item = document.createElement("li");
            item.textContent = `${label(name)} · ${number(value)} lượt`;
            list.appendChild(item);
        });
    };
    appendRanked(
        productList,
        [...productCounts.entries()].sort((left, right) => right[1] - left[1]),
        id => analyticsDataMode === "demo"
            ? `Sản phẩm Demo ${String(Number(id)).padStart(2, "0")}`
            : productById.get(Number(id)) || `Sản phẩm #${Number(id)}`
    );
    appendRanked(
        searchList,
        [...searchCounts.entries()].sort((left, right) => right[1] - left[1]),
        term => term
    );
    document.getElementById("admin-analytics-chart-title").textContent =
        range === "24h" ? "Hoạt động theo giờ (GMT+7)" : "Hoạt động theo ngày (GMT+7)";
    renderAnalyticsChart(
        analyticsEvents,
        range,
        analyticsOrdersByPeriod,
        analyticsRangeStart,
        analyticsRangeEnd
    );
}

async function loadAdminAnalytics({ append = false } = {}) {
    const status = document.getElementById("admin-analytics-status");
    const range = document.getElementById("admin-analytics-range").value;
    const moreButton = document.getElementById("admin-analytics-more");
    if (!append) {
        analyticsEvents = [];
        analyticsCursor = null;
        analyticsOrdersByPeriod = {};
        analyticsOrdersTotal = 0;
        analyticsRangeStart = null;
        analyticsRangeEnd = null;
        analyticsOrdersTruncated = false;
        analyticsDataMode = "production";
        moreButton.hidden = true;
        status.textContent = "Đang tải dữ liệu phân tích…";
        const source = document.getElementById("admin-analytics-source");
        source.textContent = "Đang xác định nguồn dữ liệu…";
        source.hidden = false;
        source.dataset.mode = "loading";
        renderAdminAnalytics(range);
    }
    moreButton.disabled = true;
    try {
        const params = new URLSearchParams({ range });
        if (analyticsCursor) params.set("cursor", analyticsCursor);
        const report = await adminApiRequest(`/api/admin/analytics?${params.toString()}`);
        analyticsEvents = analyticsEvents.concat(report.events || []);
        analyticsCursor = report.next_cursor || null;
        analyticsOrdersTotal = Number(report.orders_total || 0);
        analyticsOrdersByPeriod = report.orders_by_period || {};
        analyticsRangeStart = report.range_start;
        analyticsRangeEnd = report.range_end;
        analyticsOrdersTruncated = Boolean(report.orders_truncated);
        analyticsDataMode = report.data_mode || "production";
        const source = document.getElementById("admin-analytics-source");
        source.hidden = false;
        source.dataset.mode = analyticsDataMode;
        source.textContent = analyticsDataMode === "demo"
            ? "SYNTHETIC DEMO DATA — dữ liệu giả lập, không phải dữ liệu khách hàng."
            : analyticsDataMode === "local"
                ? "LOCAL — dữ liệu R2 cục bộ dùng cho kiểm thử."
                : "PRODUCTION — dữ liệu sự kiện R2 và đơn hàng D1.";
        renderAdminAnalytics(range);
        const statusText = analyticsCursor
            ? `Đã đọc ${numberOfAnalyticsEvents()} sự kiện; còn dữ liệu để tải tiếp.`
            : analyticsDataMode === "demo"
                ? `Đã đọc ${numberOfAnalyticsEvents()} sự kiện tổng hợp và ${analyticsOrdersTotal.toLocaleString("vi-VN")} đơn hàng Demo.`
                : analyticsEvents.length || analyticsOrdersTotal
                ? `Đã đọc ${numberOfAnalyticsEvents()} sự kiện analytics và ${analyticsOrdersTotal.toLocaleString("vi-VN")} đơn hàng từ D1.`
                : "Không có hoạt động ghi nhận: 0.";
        status.textContent = analyticsOrdersTruncated
            ? `${statusText} Biểu đồ đơn hàng bị giới hạn ở 1.000 dòng.`
            : statusText;
        moreButton.hidden = !analyticsCursor;
    } catch (error) {
        status.textContent = error.message || "Không thể tải dữ liệu phân tích.";
        throw error;
    } finally {
        moreButton.disabled = false;
    }
}

function numberOfAnalyticsEvents() {
    return analyticsEvents.length.toLocaleString("vi-VN");
}

function setAdminView(view) {
    const views = {
        orders: {
            panel: document.getElementById("admin-orders-panel"),
            title: "Quản lý đơn hàng",
            description: "Theo dõi, xử lý và cập nhật đơn hàng tại một nơi."
        },
        products: {
            panel: document.getElementById("admin-products-panel"),
            title: "Quản lý sản phẩm & tồn kho",
            description: "Cập nhật danh mục và số lượng tồn kho mà không xóa dữ liệu sản phẩm."
        },
        customers: {
            panel: document.getElementById("admin-customers-panel"),
            title: "Quản lý khách hàng",
            description: "Tra cứu hồ sơ và đơn hàng; chỉ chỉnh sửa thông tin liên hệ."
        },
        analytics: {
            panel: document.getElementById("admin-analytics-panel"),
            title: "Analytics / Thống kê",
            description: "Xem truy cập, tương tác sản phẩm, checkout và chuyển đổi theo thời gian."
        }
    };
    const selected = views[view] ? view : "orders";
    adminCurrentView = selected;

    for (const [viewName, details] of Object.entries(views)) {
        details.panel.hidden = viewName !== selected;
    }
    document.getElementById("admin-view-title").textContent = views[selected].title;
    document.getElementById("admin-view-description").textContent = views[selected].description;
    document.querySelectorAll("[data-admin-view]").forEach(button => {
        const active = button.dataset.adminView === selected;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });

    if (selected === "orders") {
        refreshAdminDashboard();
    } else if (selected === "analytics") {
        loadAdminAnalytics().catch(error => {
            console.error("Lỗi tải phân tích quản trị:", error);
        });
    } else {
        const loadView = selected === "products" ? loadAdminProducts : loadAdminCustomers;
        loadView().catch(error => {
            console.error(`Lỗi tải khu vực quản trị ${selected}:`, error);
            showToast(error.message || "Không thể tải dữ liệu quản trị.");
        });
    }
}

async function refreshCurrentAdminView() {
    if (adminCurrentView === "products") {
        await loadAdminProducts();
    } else if (adminCurrentView === "customers") {
        await loadAdminCustomers();
    } else if (adminCurrentView === "analytics") {
        await loadAdminAnalytics();
    } else {
        await refreshAdminDashboard();
    }
}

async function refreshAdminDashboard() {
    try {
        await Promise.all([loadAdminSummary(), loadAdminOrders()]);
    } catch (error) {
        console.error("Lỗi tải dữ liệu quản trị đơn hàng:", error);
        showToast(error.message || "Không thể tải dữ liệu đơn hàng.");
        if (!adminOrdersBody.querySelector(".admin-table-message")) {
            adminOrdersBody.innerHTML = `
                <tr><td colspan="7" class="admin-table-message">
                    Không thể tải đơn hàng. Vui lòng thử làm mới.
                </td></tr>
            `;
        }
    }
}

async function openAdminOrder(orderId) {
    try {
        const order = await adminApiRequest(`/api/orders/admin/${orderId}`);
        currentAdminOrder = order;
        const statusLabel = adminStatusLabels[order.status] || order.status;
        const paymentLabel = adminPaymentLabels[order.payment_status] || order.payment_status;
        const allowedStatuses = adminStatusTransitions[order.status] || [];
        const statusOptions = [
            `<option value="${escapeHTML(order.status)}">${escapeHTML(statusLabel)} (hiện tại)</option>`,
            ...allowedStatuses.map(value =>
                `<option value="${value}">${escapeHTML(adminStatusLabels[value])}</option>`
            )
        ].join("");
        const paymentOptions = Object.entries(adminPaymentLabels).map(([value, label]) =>
            `<option value="${value}" ${order.payment_status === value ? "selected" : ""}>
                ${escapeHTML(label)}
            </option>`
        ).join("");
        const note = order.note
            ? `<p>${escapeHTML(order.note).replace(/\n/g, "<br>")}</p>`
            : "<p>Không có ghi chú.</p>";

        document.getElementById("admin-order-detail").innerHTML = `
            <div class="admin-detail-heading">
                <span class="eyebrow">CHI TIẾT ĐƠN HÀNG</span>
                <h2>Đơn hàng #${Number(order.id)}</h2>
                <p>Đặt lúc ${escapeHTML(formatOrderDate(order.created_at))}</p>
            </div>
            <div class="admin-detail-grid">
                <section class="admin-detail-card">
                    <h3>Khách hàng</h3>
                    <p><strong>${escapeHTML(order.user_name || order.recipient_name)}</strong></p>
                    <p>${escapeHTML(order.user_email)}</p>
                    <p>${escapeHTML(order.recipient_phone)}</p>
                </section>
                <section class="admin-detail-card">
                    <h3>Giao hàng & thanh toán</h3>
                    <p>${escapeHTML(order.shipping_address)}</p>
                    <p>Phương thức: ${order.payment_method === "bank_transfer" ? "Chuyển khoản" : "COD"}</p>
                    <p>Thanh toán: <span class="admin-status-badge" data-status="${escapeHTML(order.payment_status)}">${escapeHTML(paymentLabel)}</span></p>
                </section>
            </div>
            <section class="admin-detail-items">
                <h3>Sản phẩm trong đơn</h3>
                ${order.items.map(item => `
                    <div class="admin-detail-item">
                        <span>${escapeHTML(item.product_name)} × ${Number(item.quantity)}</span>
                        <strong>${escapeHTML(formatPrice(item.subtotal))}</strong>
                    </div>
                `).join("")}
                <div class="admin-detail-total">
                    <span>Tổng cộng</span>
                    <span>${escapeHTML(formatPrice(order.total_amount))}</span>
                </div>
            </section>
            <section class="admin-detail-card">
                <h3>Ghi chú đơn hàng</h3>
                ${note}
            </section>
            <div class="admin-order-controls">
                <label>
                    Trạng thái đơn hàng
                    <select id="admin-detail-status">${statusOptions}</select>
                    <button type="button" data-admin-update="status" ${allowedStatuses.length ? "" : "disabled"}>
                        Cập nhật trạng thái
                    </button>
                </label>
                <label>
                    Trạng thái thanh toán
                    <select id="admin-detail-payment">${paymentOptions}</select>
                    <button type="button" data-admin-update="payment">
                        Cập nhật thanh toán
                    </button>
                </label>
            </div>
        `;

        adminOrderModal.classList.add("open");
    } catch (error) {
        console.error("Lỗi tải chi tiết đơn hàng:", error);
        showToast(error.message || "Không thể tải chi tiết đơn hàng.");
    }
}

function openAdminProductForm(product = null) {
    const form = document.getElementById("admin-product-form");
    const editor = document.getElementById("admin-product-editor");
    form.reset();
    document.getElementById("admin-product-error").textContent = "";
    document.getElementById("admin-product-id").value = product ? String(product.id) : "";
    document.getElementById("admin-product-form-title").textContent =
        product ? `Sửa sản phẩm #${product.id}` : "Thêm sản phẩm";

    if (product) {
        document.getElementById("admin-product-name").value = product.name || "";
        document.getElementById("admin-product-brand").value = product.brand || "";
        document.getElementById("admin-product-category").value = product.category || "";
        document.getElementById("admin-product-price").value = String(product.price);
        document.getElementById("admin-product-sale-price").value = product.sale_price ?? "";
        document.getElementById("admin-product-stock").value = String(product.stock);
        document.getElementById("admin-product-is-active").value = String(Boolean(product.is_active));
        document.getElementById("admin-product-badge").value = product.badge || "";
        document.getElementById("admin-product-image").value = product.image || "";
        document.getElementById("admin-product-description").value = product.description || "";
        document.getElementById("admin-product-specifications").value =
            product.specifications ? JSON.stringify(product.specifications, null, 2) : "";
    }

    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function openAdminCustomer(customerId) {
    const editor = document.getElementById("admin-customer-editor");
    const errorElement = document.getElementById("admin-customer-error");
    errorElement.textContent = "";

    try {
        const customer = await adminApiRequest(`/api/admin/customers/${customerId}`);
        document.getElementById("admin-customer-id").value = String(customer.id);
        document.getElementById("admin-customer-name").value = customer.full_name || "";
        document.getElementById("admin-customer-phone").value = customer.phone || "";
        document.getElementById("admin-customer-address").value = customer.address || "";

        const orderSummary = document.getElementById("admin-customer-order-summary");
        orderSummary.textContent = customer.orders.length
            ? `Đơn hàng gần đây: ${customer.orders.map(order =>
                `#${order.id} (${order.status}, ${formatPrice(order.total_amount)})`
            ).join(" · ")}`
            : "Khách hàng chưa có đơn hàng.";

        editor.hidden = false;
        editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
        errorElement.textContent = error.message || "Không thể tải thông tin khách hàng.";
        throw error;
    }
}

document.getElementById("admin-orders-toggle").addEventListener("click", async () => {
    if (!adminOrdersSection.hidden) {
        adminOrdersSection.hidden = true;
        return;
    }

    const access = await checkAdminAccess();

    if (access === "login") {
        adminLoginModal.classList.add("open");
        return;
    }

    if (access === "denied") {
        showToast("Tài khoản hiện tại không có quyền quản trị.");
        return;
    }

    if (access !== "authorized") {
        return;
    }

    adminOrdersSection.hidden = false;
    adminOrdersSection.scrollIntoView({ behavior: "smooth" });
    setAdminView("orders");
});

document.getElementById("admin-login-close").addEventListener("click", () => {
    adminLoginModal.classList.remove("open");
});

adminLoginModal.addEventListener("click", event => {
    if (event.target === adminLoginModal) {
        adminLoginModal.classList.remove("open");
    }
});

document.getElementById("admin-login-form").addEventListener("submit", async event => {
    event.preventDefault();

    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const errorElement = document.getElementById("admin-login-error");
    errorElement.textContent = "";
    submitButton.disabled = true;

    try {
        const formData = new FormData(form);
        const response = await fetch(apiUrl("/api/auth/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: String(formData.get("email") || "").trim(),
                password: String(formData.get("password") || "")
            })
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(getApiErrorMessage(result.detail));
        }

        if (!result.user || result.user.role !== "admin") {
            throw new Error("Tài khoản này không có quyền quản trị.");
        }

        accessToken = result.access_token;
        localStorage.setItem("hoangdz_token", accessToken);
        localStorage.setItem("hoangdz_user", JSON.stringify(result.user));
        currentUser = result.user;
        updateAccountToggle();
        form.reset();
        adminLoginModal.classList.remove("open");
        adminOrdersSection.hidden = false;
        adminOrdersSection.scrollIntoView({ behavior: "smooth" });
        setAdminView("orders");
    } catch (error) {
        console.error("Lỗi đăng nhập quản trị:", error);
        errorElement.textContent = error.message || "Không thể đăng nhập.";
    } finally {
        submitButton.disabled = false;
    }
});

document.querySelectorAll("[data-admin-view]").forEach(button => {
    button.addEventListener("click", () => setAdminView(button.dataset.adminView));
});

document.getElementById("admin-analytics-range").addEventListener("change", () => {
    loadAdminAnalytics().catch(error => {
        console.error("Lỗi tải phân tích quản trị:", error);
    });
});

document.getElementById("admin-analytics-more").addEventListener("click", () => {
    loadAdminAnalytics({ append: true }).catch(error => {
        console.error("Lỗi tải thêm dữ liệu phân tích:", error);
    });
});

document.getElementById("admin-orders-refresh").addEventListener("click", () => {
    refreshCurrentAdminView().catch(error => {
        console.error("Lỗi làm mới khu vực quản trị:", error);
        showToast(error.message || "Không thể làm mới dữ liệu.");
    });
});

document.getElementById("admin-product-create").addEventListener("click", () => {
    openAdminProductForm();
});

document.getElementById("admin-product-cancel").addEventListener("click", () => {
    document.getElementById("admin-product-editor").hidden = true;
});

document.getElementById("admin-products-filters").addEventListener("submit", event => {
    event.preventDefault();
    adminProductsPage = 1;
    loadAdminProducts().catch(error => {
        console.error("Lỗi tìm sản phẩm quản trị:", error);
        showToast(error.message || "Không thể tìm sản phẩm.");
    });
});

document.getElementById("admin-product-active-filter").addEventListener("change", () => {
    adminProductsPage = 1;
    loadAdminProducts().catch(error => showToast(error.message || "Không thể lọc sản phẩm."));
});

document.getElementById("admin-products-page-prev").addEventListener("click", () => {
    if (adminProductsPage > 1) {
        adminProductsPage--;
        loadAdminProducts().catch(error => showToast(error.message || "Không thể tải trang."));
    }
});

document.getElementById("admin-products-page-next").addEventListener("click", () => {
    if (adminProductsPage < adminProductsTotalPages) {
        adminProductsPage++;
        loadAdminProducts().catch(error => showToast(error.message || "Không thể tải trang."));
    }
});

adminProductsBody.addEventListener("click", async event => {
    const editButton = event.target.closest("[data-admin-product-edit]");
    if (editButton) {
        const product = adminProductCache.get(Number(editButton.dataset.adminProductEdit));
        if (product) {
            openAdminProductForm(product);
        } else {
            showToast("Không tìm thấy sản phẩm trong danh sách hiện tại. Hãy tải lại.");
        }
        return;
    }

    const visibilityButton = event.target.closest("[data-admin-product-visibility]");
    if (!visibilityButton) return;

    visibilityButton.disabled = true;
    try {
        await adminApiRequest(
            `/api/admin/products/${Number(visibilityButton.dataset.adminProductVisibility)}/visibility`,
            {
                method: "PATCH",
                body: JSON.stringify({ is_active: visibilityButton.dataset.active !== "true" })
            }
        );
        await loadAdminProducts();
        await loadProducts();
        showToast("Đã cập nhật trạng thái hiển thị sản phẩm.");
    } catch (error) {
        console.error("Lỗi cập nhật trạng thái sản phẩm:", error);
        showToast(error.message || "Không thể cập nhật sản phẩm.");
    } finally {
        visibilityButton.disabled = false;
    }
});

document.getElementById("admin-product-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const errorElement = document.getElementById("admin-product-error");
    const productId = document.getElementById("admin-product-id").value;
    errorElement.textContent = "";
    submitButton.disabled = true;

    try {
        const price = Number(document.getElementById("admin-product-price").value);
        const salePriceInput = document.getElementById("admin-product-sale-price").value;
        const stock = Number(document.getElementById("admin-product-stock").value);
        if (!Number.isSafeInteger(price) || price <= 0 ||
            !Number.isSafeInteger(stock) || stock < 0) {
            throw new Error("Giá và tồn kho phải là số nguyên hợp lệ.");
        }
        const salePrice = salePriceInput === "" ? null : Number(salePriceInput);
        if (salePrice !== null && (!Number.isSafeInteger(salePrice) || salePrice <= 0)) {
            throw new Error("Giá khuyến mãi phải là số nguyên dương.");
        }

        const specificationsInput = document.getElementById("admin-product-specifications").value.trim();
        let specifications = null;
        if (specificationsInput) {
            specifications = JSON.parse(specificationsInput);
            if (!specifications || typeof specifications !== "object" || Array.isArray(specifications)) {
                throw new Error("Thông số kỹ thuật phải là một JSON object.");
            }
        }

        const payload = {
            name: document.getElementById("admin-product-name").value.trim(),
            brand: document.getElementById("admin-product-brand").value.trim(),
            category: document.getElementById("admin-product-category").value.trim(),
            price,
            sale_price: salePrice,
            stock,
            is_active: document.getElementById("admin-product-is-active").value === "true",
            badge: document.getElementById("admin-product-badge").value.trim() || null,
            image: document.getElementById("admin-product-image").value.trim() || null,
            description: document.getElementById("admin-product-description").value.trim() || null,
            specifications
        };
        await adminApiRequest(
            productId ? `/api/admin/products/${Number(productId)}` : "/api/admin/products",
            {
                method: productId ? "PUT" : "POST",
                body: JSON.stringify(payload)
            }
        );
        document.getElementById("admin-product-editor").hidden = true;
        await loadAdminProducts();
        await loadProducts();
        showToast(productId ? "Đã cập nhật sản phẩm." : "Đã thêm sản phẩm.");
    } catch (error) {
        console.error("Lỗi lưu sản phẩm:", error);
        errorElement.textContent = error.message || "Không thể lưu sản phẩm.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("admin-customers-filters").addEventListener("submit", event => {
    event.preventDefault();
    adminCustomersPage = 1;
    loadAdminCustomers().catch(error => {
        console.error("Lỗi tìm khách hàng:", error);
        showToast(error.message || "Không thể tìm khách hàng.");
    });
});

document.getElementById("admin-customers-page-prev").addEventListener("click", () => {
    if (adminCustomersPage > 1) {
        adminCustomersPage--;
        loadAdminCustomers().catch(error => showToast(error.message || "Không thể tải trang."));
    }
});

document.getElementById("admin-customers-page-next").addEventListener("click", () => {
    if (adminCustomersPage < adminCustomersTotalPages) {
        adminCustomersPage++;
        loadAdminCustomers().catch(error => showToast(error.message || "Không thể tải trang."));
    }
});

adminCustomersBody.addEventListener("click", event => {
    const button = event.target.closest("[data-admin-customer-edit]");
    if (button) {
        openAdminCustomer(Number(button.dataset.adminCustomerEdit)).catch(error => {
            console.error("Lỗi mở hồ sơ khách hàng:", error);
        });
    }
});

document.getElementById("admin-customer-cancel").addEventListener("click", () => {
    document.getElementById("admin-customer-editor").hidden = true;
});

document.getElementById("admin-customer-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const errorElement = document.getElementById("admin-customer-error");
    const customerId = Number(document.getElementById("admin-customer-id").value);
    errorElement.textContent = "";
    submitButton.disabled = true;

    try {
        const updatedCustomer = await adminApiRequest(`/api/admin/customers/${customerId}`, {
            method: "PATCH",
            body: JSON.stringify({
                full_name: document.getElementById("admin-customer-name").value.trim(),
                phone: document.getElementById("admin-customer-phone").value.trim() || null,
                address: document.getElementById("admin-customer-address").value.trim() || null
            })
        });
        document.getElementById("admin-customer-name").value = updatedCustomer.full_name;
        document.getElementById("admin-customer-phone").value = updatedCustomer.phone || "";
        document.getElementById("admin-customer-address").value = updatedCustomer.address || "";
        await loadAdminCustomers();
        showToast("Đã cập nhật thông tin liên hệ khách hàng.");
    } catch (error) {
        console.error("Lỗi cập nhật khách hàng:", error);
        errorElement.textContent = error.message || "Không thể cập nhật khách hàng.";
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("admin-orders-filters").addEventListener("submit", event => {
    event.preventDefault();
    adminOrdersPage = 1;
    loadAdminOrders().catch(error => {
        console.error("Lỗi tìm kiếm đơn hàng:", error);
        showToast(error.message || "Không thể tìm đơn hàng.");
    });
});

document.getElementById("admin-status-filter").addEventListener("change", () => {
    adminOrdersPage = 1;
    loadAdminOrders().catch(error => showToast(error.message));
});

document.getElementById("admin-payment-filter").addEventListener("change", () => {
    adminOrdersPage = 1;
    loadAdminOrders().catch(error => showToast(error.message));
});

document.getElementById("admin-page-prev").addEventListener("click", () => {
    if (adminOrdersPage > 1) {
        adminOrdersPage--;
        loadAdminOrders().catch(error => showToast(error.message));
    }
});

document.getElementById("admin-page-next").addEventListener("click", () => {
    adminOrdersPage++;
    loadAdminOrders().catch(error => showToast(error.message));
});

adminOrdersBody.addEventListener("click", event => {
    const button = event.target.closest("[data-order-id]");

    if (button) {
        openAdminOrder(Number(button.dataset.orderId));
    }
});

document.getElementById("admin-order-close").addEventListener("click", () => {
    adminOrderModal.classList.remove("open");
});

adminOrderModal.addEventListener("click", event => {
    if (event.target === adminOrderModal) {
        adminOrderModal.classList.remove("open");
    }
});

document.getElementById("admin-order-detail").addEventListener("click", async event => {
    const button = event.target.closest("[data-admin-update]");

    if (!button || !currentAdminOrder) {
        return;
    }

    const field = button.dataset.adminUpdate;
    const orderId = currentAdminOrder.id;
    const isStatus = field === "status";
    const value = document.getElementById(
        isStatus ? "admin-detail-status" : "admin-detail-payment"
    ).value;
    const currentValue = isStatus
        ? currentAdminOrder.status
        : currentAdminOrder.payment_status;

    if (value === currentValue) {
        showToast("Trạng thái không thay đổi.");
        return;
    }

    button.disabled = true;

    try {
        await adminApiRequest(
            `/api/orders/admin/${orderId}/${isStatus ? "status" : "payment"}`,
            {
                method: "PATCH",
                body: JSON.stringify(
                    isStatus ? { status: value } : { payment_status: value }
                )
            }
        );

        showToast("Cập nhật đơn hàng thành công.");
        await Promise.all([
            openAdminOrder(orderId),
            loadAdminOrders(),
            loadAdminSummary()
        ]);
    } catch (error) {
        console.error("Lỗi cập nhật đơn hàng:", error);
        showToast(error.message || "Không thể cập nhật đơn hàng.");
        button.disabled = false;
    }
});


// ==========================================
// 23. MENU MOBILE
// ==========================================

document.getElementById("menu-toggle").addEventListener("click", () => {
    document.querySelector(".nav-links").classList.toggle("show");
});

document.querySelectorAll(".nav-links a").forEach(link => {
    link.addEventListener("click", () => {
        document.querySelector(".nav-links").classList.remove("show");
    });
});


// ==========================================
// 24. KHOI CHAY WEBSITE
// ==========================================

initializeAnalyticsConsent();
window.addEventListener("hashchange", () => {
    const page = ["home", "products", "orders"].includes(location.hash.slice(1))
        ? location.hash.slice(1)
        : "home";
    trackAnalytics("page_view", { page });
});
initializeAuth();
loadProducts();

console.log("HOANGDZ STORE da khoi chay thanh cong!");
