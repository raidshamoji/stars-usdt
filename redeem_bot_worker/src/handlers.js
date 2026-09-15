import * as db from "./db.js";

function isAdmin(userId, adminIds) {
  return adminIds.includes(String(userId));
}

// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------

export async function handleStart(ctx) {
  const { tg, D1, chatId } = ctx;
  const products = await db.listProducts(D1);
  if (!products.length) {
    await tg.sendMessage(chatId, "No products available right now. Check back soon!");
    return;
  }

  const buttons = [];
  for (const p of products) {
    const left = await db.stockCount(D1, p.id);
    let label = `${p.name} — ⭐${p.price_stars} / $${p.price_usdt} USDT`;
    if (left === 0) label += " (out of stock)";
    buttons.push([{ text: label, callback_data: `prod:${p.id}` }]);
  }

  await tg.sendMessage(chatId, "🛒 Welcome! Pick a product to buy:", {
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---------------------------------------------------------------------------
// Product chosen -> payment method picker
// ---------------------------------------------------------------------------

export async function handleProductChosen(ctx, productId) {
  const { tg, D1, chatId, messageId } = ctx;
  const product = await db.getProduct(D1, productId);
  if (!product) {
    await tg.editMessageText(chatId, messageId, "Product not found.");
    return;
  }
  const left = await db.stockCount(D1, productId);
  if (left === 0) {
    await tg.editMessageText(chatId, messageId, `Sorry, ${product.name} is out of stock.`);
    return;
  }

  const text = `*${product.name}*\n${product.description}\n\nChoose a payment method:`;
  const buttons = [
    [{ text: `Pay ⭐ ${product.price_stars} Stars`, callback_data: `pay_stars:${productId}` }],
    [{ text: `Pay $${product.price_usdt} USDT (crypto)`, callback_data: `pay_crypto:${productId}` }],
  ];
  await tg.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: buttons } });
}

// ---------------------------------------------------------------------------
// Telegram Stars payment
// ---------------------------------------------------------------------------

export async function handlePayStars(ctx, productId) {
  const { tg, D1, chatId, userId } = ctx;
  const product = await db.getProduct(D1, productId);
  if (!product || (await db.stockCount(D1, productId)) === 0) {
    await tg.sendMessage(chatId, "Sorry, that product is no longer available.");
    return;
  }
  const orderId = await db.createOrder(D1, userId, productId, "stars", product.price_stars, "XTR");

  await tg.sendInvoice(chatId, {
    title: product.name,
    description: product.description || product.name,
    payload: `order:${orderId}`,
    currency: "XTR",
    amount: product.price_stars,
  });
}

export async function handlePreCheckout(ctx) {
  const { tg, D1, preCheckoutQuery } = ctx;
  const payload = preCheckoutQuery.invoice_payload;
  if (!payload.startsWith("order:")) {
    await tg.answerPreCheckoutQuery(preCheckoutQuery.id, false, "Invalid order.");
    return;
  }
  const orderId = Number(payload.split(":")[1]);
  const order = await db.getOrder(D1, orderId);
  if (!order || order.status !== "pending") {
    await tg.answerPreCheckoutQuery(preCheckoutQuery.id, false, "This order is no longer valid.");
    return;
  }
  if ((await db.stockCount(D1, order.product_id)) === 0) {
    await tg.answerPreCheckoutQuery(preCheckoutQuery.id, false, "Out of stock, sorry.");
    return;
  }
  await tg.answerPreCheckoutQuery(preCheckoutQuery.id, true);
}

export async function handleSuccessfulPayment(ctx) {
  const { tg, D1, chatId, userId, successfulPayment } = ctx;
  const orderId = Number(successfulPayment.invoice_payload.split(":")[1]);
  const order = await db.getOrder(D1, orderId);
  if (!order) {
    await tg.sendMessage(chatId, "Payment received, but the order was not found. Contact support.");
    return;
  }
  await db.markOrderPaid(D1, orderId, successfulPayment.telegram_payment_charge_id);
  await deliverCode(ctx, orderId, order.product_id, userId);
}

// ---------------------------------------------------------------------------
// Crypto payment
// ---------------------------------------------------------------------------

export async function handlePayCrypto(ctx, productId) {
  const { tg, D1, cryptoPay, chatId, userId, messageId } = ctx;
  const product = await db.getProduct(D1, productId);
  if (!product || (await db.stockCount(D1, productId)) === 0) {
    await tg.editMessageText(chatId, messageId, "Sorry, that product is no longer available.");
    return;
  }
  const orderId = await db.createOrder(D1, userId, productId, "crypto", product.price_usdt, "USDT");

  let invoice;
  try {
    invoice = await cryptoPay.createInvoice(product.price_usdt, product.name, `order:${orderId}`);
  } catch (e) {
    console.error(e);
    await tg.editMessageText(
      chatId,
      messageId,
      "Crypto payments are temporarily unavailable. Please try Stars instead or contact support."
    );
    return;
  }
  await db.setOrderExternalId(D1, orderId, String(invoice.invoice_id));

  const buttons = [
    [{ text: "💳 Pay now", url: invoice.pay_url }],
    [{ text: "✅ I've paid — check status", callback_data: `check_crypto:${orderId}` }],
  ];
  await tg.editMessageText(
    chatId,
    messageId,
    `Pay $${product.price_usdt} USDT for *${product.name}*.\n\n` +
      "Tap **Pay now**, complete payment in @CryptoBot, then tap **I've paid**.",
    { reply_markup: { inline_keyboard: buttons } }
  );
}

export async function handleCheckCrypto(ctx, orderId) {
  const { tg, D1, cryptoPay, chatId, userId, messageId, callbackQueryId } = ctx;
  const order = await db.getOrder(D1, orderId);
  if (!order) {
    await tg.answerCallbackQuery(callbackQueryId, { text: "Order not found.", show_alert: true });
    return;
  }
  if (order.status === "paid" || order.status === "delivered") {
    await tg.answerCallbackQuery(callbackQueryId, {
      text: "Already delivered — check your messages.",
      show_alert: true,
    });
    return;
  }
  if (!order.external_id) {
    await tg.answerCallbackQuery(callbackQueryId, {
      text: "Could not find this invoice, please start over with /start.",
      show_alert: true,
    });
    return;
  }

  const status = await cryptoPay.getInvoiceStatus(order.external_id);
  if (status === "paid") {
    await tg.answerCallbackQuery(callbackQueryId, { text: "Payment confirmed!" });
    await db.markOrderPaid(D1, orderId, order.external_id);
    await deliverCode(ctx, orderId, order.product_id, userId);
    await tg.editMessageText(chatId, messageId, "✅ Payment confirmed — code delivered above!");
  } else if (status === "expired") {
    await tg.answerCallbackQuery(callbackQueryId, {
      text: "This invoice expired. Please start a new order.",
      show_alert: true,
    });
  } else {
    await tg.answerCallbackQuery(callbackQueryId, {
      text: "Not paid yet. Complete the payment and try again.",
      show_alert: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function deliverCode(ctx, orderId, productId, userId) {
  const { tg, D1, chatId } = ctx;
  const code = await db.claimCode(D1, productId, userId, orderId);
  if (code === null) {
    await tg.sendMessage(
      chatId,
      "Payment received, but we're out of stock for this item. " +
        "Our team will refund you or restock shortly — contact support."
    );
    return;
  }
  await db.markOrderDelivered(D1, orderId);
  await tg.sendMessage(chatId, `✅ Payment confirmed! Here is your code:\n\n\`${code}\``);
}

// ---------------------------------------------------------------------------
// Admin commands
// ---------------------------------------------------------------------------

export async function handleAddProduct(ctx, argsText) {
  const { tg, D1, chatId, userId, adminIds } = ctx;
  if (!isAdmin(userId, adminIds)) return;
  try {
    const [name, desc, stars, usdt] = argsText.split("|").map((s) => s.trim());
    const id = await db.addProduct(D1, name, desc, parseInt(stars, 10), parseFloat(usdt));
    await tg.sendMessage(chatId, `Product created with id ${id}.`);
  } catch (e) {
    await tg.sendMessage(
      chatId,
      "Usage: /addproduct Name | Description | price_in_stars | price_in_usdt\n" +
        "Example: /addproduct 1000 Gems | Game top-up | 150 | 2.99"
    );
  }
}

export async function handleAddCodes(ctx, argsText, replyText) {
  const { tg, D1, chatId, userId, adminIds } = ctx;
  if (!isAdmin(userId, adminIds)) return;

  const firstLineBreak = argsText.indexOf(" ");
  const productIdStr = firstLineBreak === -1 ? argsText : argsText.slice(0, firstLineBreak);
  const productId = parseInt(productIdStr.trim(), 10);
  if (!productId) {
    await tg.sendMessage(
      chatId,
      "Usage: /addcodes <product_id>\nThen paste codes, one per line, in the same message after the id."
    );
    return;
  }

  let codesText = firstLineBreak === -1 ? "" : argsText.slice(firstLineBreak + 1);
  if (replyText) codesText += "\n" + replyText;
  const codes = codesText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!codes.length) {
    await tg.sendMessage(chatId, "No codes found in the message.");
    return;
  }
  const added = await db.addCodes(D1, productId, codes);
  await tg.sendMessage(chatId, `Added ${added} codes to product ${productId}.`);
}

export async function handleStats(ctx) {
  const { tg, D1, chatId, userId, adminIds } = ctx;
  if (!isAdmin(userId, adminIds)) return;
  const s = await db.stats(D1);
  await tg.sendMessage(
    chatId,
    `📊 Orders (paid/delivered): ${s.totalOrders}\n` +
      `⭐ Stars revenue: ${s.revenueStars}\n` +
      `💵 Crypto revenue: $${s.revenueCryptoUsdt} USDT`
  );
}
