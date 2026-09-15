CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_stars INTEGER NOT NULL,
  price_usdt REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  is_sold INTEGER NOT NULL DEFAULT 0,
  sold_to_user_id INTEGER,
  sold_at INTEGER,
  order_id INTEGER,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  external_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_codes_product_unsold ON codes(product_id, is_sold);
