import { makeTelegramApi } from "./telegram.js";
import { makeCryptoPayApi } from "./cryptopay.js";
import * as handlers from "./handlers.js";

export default {
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Redeem bot worker is running.", { status: 200 });
    }

    // One-time convenience endpoint to register the Telegram webhook.
    // Visit: https://<your-worker>.workers.dev/setup?key=<SETUP_KEY>
    if (request.method === "GET" && url.pathname === "/setup") {
      if (url.searchParams.get("key") !== env.SETUP_KEY) {
        return new Response("Forbidden", { status: 403 });
      }
      const tg = makeTelegramApi(env.BOT_TOKEN);
      const webhookUrl = `${url.origin}/webhook`;
      const result = await tg.setWebhook(webhookUrl, env.WEBHOOK_SECRET);
      return Response.json(result);
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      // Verify the request really came from Telegram.
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = await request.json();
      executionCtx.waitUntil(routeUpdate(update, env));
      // Reply immediately; Telegram just needs a fast 200 OK.
      return new Response("OK", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function routeUpdate(update, env) {
  const tg = makeTelegramApi(env.BOT_TOKEN);
  const cryptoPay = makeCryptoPayApi(env.CRYPTO_PAY_API_BASE, env.CRYPTO_PAY_TOKEN);
  const adminIds = (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const D1 = env.DB;

  try {
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const ctx = { tg, D1, cryptoPay, chatId, userId, adminIds };

      if (msg.successful_payment) {
        await handlers.handleSuccessfulPayment({ ...ctx, successfulPayment: msg.successful_payment });
        return;
      }

      const text = msg.text || "";
      if (text.startsWith("/start")) {
        await handlers.handleStart(ctx);
      } else if (text.startsWith("/addproduct")) {
        await handlers.handleAddProduct(ctx, text.slice("/addproduct".length).trim());
      } else if (text.startsWith("/addcodes")) {
        const replyText = msg.reply_to_message ? msg.reply_to_message.text : null;
        await handlers.handleAddCodes(ctx, text.slice("/addcodes".length).trim(), replyText);
      } else if (text.startsWith("/stats")) {
        await handlers.handleStats(ctx);
      }
      return;
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const userId = cq.from.id;
      const data = cq.data || "";
      const ctx = {
        tg,
        D1,
        cryptoPay,
        chatId,
        userId,
        messageId,
        callbackQueryId: cq.id,
        adminIds,
      };

      if (data.startsWith("prod:")) {
        await handlers.handleProductChosen(ctx, Number(data.split(":")[1]));
        await tg.answerCallbackQuery(cq.id);
      } else if (data.startsWith("pay_stars:")) {
        await handlers.handlePayStars(ctx, Number(data.split(":")[1]));
        await tg.answerCallbackQuery(cq.id);
      } else if (data.startsWith("pay_crypto:")) {
        await handlers.handlePayCrypto(ctx, Number(data.split(":")[1]));
        await tg.answerCallbackQuery(cq.id);
      } else if (data.startsWith("check_crypto:")) {
        await handlers.handleCheckCrypto(ctx, Number(data.split(":")[1]));
      } else {
        await tg.answerCallbackQuery(cq.id);
      }
      return;
    }

    if (update.pre_checkout_query) {
      const ctx = { tg, D1, preCheckoutQuery: update.pre_checkout_query };
      await handlers.handlePreCheckout(ctx);
      return;
    }
  } catch (err) {
    console.error("Error handling update:", err);
  }
}
