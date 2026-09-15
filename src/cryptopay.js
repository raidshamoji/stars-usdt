// Client for the @CryptoBot "Crypto Pay" API. Docs: https://help.crypt.bot/crypto-pay-api

export function makeCryptoPayApi(apiBase, token) {
  async function call(method, params) {
    const res = await fetch(`${apiBase}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Crypto-Pay-API-Token": token,
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`CryptoPay ${method} failed: ${JSON.stringify(data.error ?? data)}`);
    }
    return data.result;
  }

  return {
    createInvoice: (amountUsdt, description, payload, asset = "USDT") =>
      call("createInvoice", {
        amount: String(amountUsdt),
        asset,
        description,
        payload,
        expires_in: 1800,
      }),

    getInvoiceStatus: async (invoiceId) => {
      const result = await call("getInvoices", { invoice_ids: String(invoiceId) });
      const items = result.items ?? [];
      return items.length ? items[0].status : null; // 'active' | 'paid' | 'expired'
    },
  };
}
