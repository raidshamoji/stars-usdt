// All D1 queries live here. D1 is SQLite, so the schema/statements are
// nearly identical to a local sqlite3 setup — the main difference is the
// async prepared-statement API instead of a synchronous connection.

export async function listProducts(db) {
  const { results } = await db
    .prepare("SELECT * FROM products WHERE active = 1 ORDER BY id")
    .all();
  return results;
}

export async function getProduct(db, productId) {
  return db.prepare("SELECT * FROM products WHERE id = ?").bind(productId).first();
}

export async function stockCount(db, productId) {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM codes WHERE product_id = ? AND is_sold = 0")
    .bind(productId)
    .first();
  return row.c;
}

export async function addProduct(db, name, description, priceStars, priceUsdt) {
  const res = await db
    .prepare(
      "INSERT INTO products (name, description, price_stars, price_usdt) VALUES (?,?,?,?)"
    )
    .bind(name, description, priceStars, priceUsdt)
    .run();
  return res.meta.last_row_id;
}

export async function addCodes(db, productId, codes) {
  const stmt = db.prepare("INSERT INTO codes (product_id, code) VALUES (?,?)");
  const batch = codes
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => stmt.bind(productId, c));
  if (batch.length) await db.batch(batch);
  return batch.length;
}

export async function createOrder(db, userId, productId, method, amount, currency) {
  const res = await db
    .prepare(
      `INSERT INTO orders (user_id, product_id, payment_method, amount, currency, status, created_at)
       VALUES (?,?,?,?,?, 'pending', ?)`
    )
    .bind(userId, productId, method, amount, currency, Math.floor(Date.now() / 1000))
    .run();
  return res.meta.last_row_id;
}

export async function getOrder(db, orderId) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
}

export async function setOrderExternalId(db, orderId, externalId) {
  await db.prepare("UPDATE orders SET external_id = ? WHERE id = ?").bind(externalId, orderId).run();
}

export async function markOrderPaid(db, orderId, externalId) {
  await db
    .prepare("UPDATE orders SET status='paid', external_id = COALESCE(?, external_id) WHERE id = ?")
    .bind(externalId ?? null, orderId)
    .run();
}

export async function markOrderDelivered(db, orderId) {
  await db.prepare("UPDATE orders SET status='delivered' WHERE id = ?").bind(orderId).run();
}

// Atomically reserve one unsold code in a single statement (UPDATE ... WHERE id = (subquery))
// so two simultaneous buyers can never be handed the same code.
export async function claimCode(db, productId, userId, orderId) {
  const row = await db
    .prepare(
      `UPDATE codes
         SET is_sold = 1, sold_to_user_id = ?, sold_at = ?, order_id = ?
       WHERE id = (
         SELECT id FROM codes WHERE product_id = ? AND is_sold = 0 LIMIT 1
       )
       RETURNING code`
    )
    .bind(userId, Math.floor(Date.now() / 1000), orderId, productId)
    .first();
  return row ? row.code : null;
}

export async function stats(db) {
  const orders = await db
    .prepare("SELECT COUNT(*) c FROM orders WHERE status IN ('paid','delivered')")
    .first();
  const stars = await db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) s FROM orders WHERE payment_method='stars' AND status IN ('paid','delivered')"
    )
    .first();
  const crypto = await db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) s FROM orders WHERE payment_method='crypto' AND status IN ('paid','delivered')"
    )
    .first();
  return { totalOrders: orders.c, revenueStars: stars.s, revenueCryptoUsdt: crypto.s };
}
