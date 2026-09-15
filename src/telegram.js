// Thin wrapper around the Telegram Bot API — no SDK needed, just fetch.

export function makeTelegramApi(botToken) {
  const base = `https://api.telegram.org/bot${botToken}`;

  async function call(method, payload) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Telegram API error in ${method}:`, data);
    }
    return data;
  }

  return {
    sendMessage: (chatId, text, extra = {}) =>
      call("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown", ...extra }),

    editMessageText: (chatId, messageId, text, extra = {}) =>
      call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "Markdown",
        ...extra,
      }),

    answerCallbackQuery: (callbackQueryId, extra = {}) =>
      call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...extra }),

    answerPreCheckoutQuery: (preCheckoutQueryId, ok, errorMessage) =>
      call("answerPreCheckoutQuery", {
        pre_checkout_query_id: preCheckoutQueryId,
        ok,
        ...(errorMessage ? { error_message: errorMessage } : {}),
      }),

    sendInvoice: (chatId, { title, description, payload, currency, amount }) =>
      call("sendInvoice", {
        chat_id: chatId,
        title,
        description,
        payload,
        provider_token: "", // empty string required for Telegram Stars (XTR) digital goods
        currency,
        prices: [{ label: title, amount }],
      }),

    setWebhook: (url, secretToken) =>
      call("setWebhook", {
        url,
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query", "pre_checkout_query"],
      }),
  };
}
