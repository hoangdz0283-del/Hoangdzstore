CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price > 0),
    image TEXT,
    badge TEXT,
    brand TEXT NOT NULL DEFAULT 'Unknown',
    description TEXT,
    sale_price INTEGER CHECK (sale_price IS NULL OR sale_price > 0),
    stock INTEGER NOT NULL DEFAULT 10 CHECK (stock >= 0),
    specifications TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    role TEXT NOT NULL DEFAULT 'customer',
    created_at TEXT
);
CREATE INDEX users_created_at_idx ON users(created_at DESC, id DESC);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT NOT NULL,
    shipping_address TEXT NOT NULL,
    total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
    payment_method TEXT NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod', 'bank_transfer')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'preparing', 'shipping', 'delivered', 'cancelled')),
    note TEXT,
    created_at TEXT,
    checkout_key TEXT UNIQUE,
    checkout_fingerprint TEXT,
    cancel_key TEXT UNIQUE
);
CREATE INDEX orders_user_created_idx ON orders(user_id, created_at DESC, id DESC);
CREATE INDEX orders_created_idx ON orders(created_at DESC, id DESC);
CREATE INDEX orders_status_idx ON orders(status, payment_status);

CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
    stock_deducted INTEGER NOT NULL DEFAULT 0 CHECK (stock_deducted IN (0, 1))
);
CREATE INDEX order_items_order_id_idx ON order_items(order_id);

CREATE TABLE password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at TEXT
);

CREATE TABLE auth_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0)
);
