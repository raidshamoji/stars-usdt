# Redeem Code Shop — Cloudflare Worker edition

Same bot, rebuilt to run on Cloudflare Workers' **free tier**:

- No server to keep running — Telegram pushes updates to your Worker via a **webhook** (the earlier Python version used long-polling, which needs an always-on process; Workers don't have that, so this version is event-driven instead).
- Storage is **D1** (Cloudflare's built-in SQLite) instead of a local `.db` file — free tier gives you 5 GB storage and 5M rows read/day, far more than a code shop needs.
- Stock claiming stays atomic (one SQL `UPDATE ... WHERE id = (subquery) RETURNING`), so two buyers can never get the same code.

Free tier limits that matter here: 100,000 requests/day and D1's free quota — both comfortably cover a small-to-medium shop.

## 1. Prerequisites

```bash
npm install -g wrangler
wrangler login
```

## 2. Create the D1 database

```bash
cd redeem_bot_worker
npm install
wrangler d1 create redeem_bot_db
```

This prints a `database_id`. Copy it into `wrangler.toml` under `[[d1_databases]]`.

Then apply the schema:

```bash
npm run db:migrate
```

## 3. Set secrets

```bash
wrangler secret put BOT_TOKEN
# paste the token from @BotFather

wrangler secret put CRYPTO_PAY_TOKEN
# paste the token from @CryptoBot -> Crypto Pay -> Create App

wrangler secret put WEBHOOK_SECRET
# make up any random string, e.g. output of: openssl rand -hex 24
# Telegram will echo this back on every webhook call so you can verify
# requests really came from Telegram and not a random bot on the internet.

wrangler secret put SETUP_KEY
# another random string — protects the one-time /setup endpoint below
```

Edit `wrangler.toml` and set `ADMIN_IDS` to your numeric Telegram user ID
(get it from [@userinfobot](https://t.me/userinfobot)); comma-separate for
multiple admins.

## 4. Deploy

```bash
npm run deploy
```

Wrangler prints your Worker's URL, e.g. `https://redeem-bot.yourname.workers.dev`.

## 5. Register the Telegram webhook

Visit this URL once in your browser (replace both placeholders):

```
https://redeem-bot.yourname.workers.dev/setup?key=YOUR_SETUP_KEY
```

You should see `{"ok":true,"result":true,...}`. That's it — Telegram now
pushes every update straight to your Worker.

## 6. Add products and stock

Same admin commands as before, sent to your bot in Telegram:

```
/addproduct 1000 Gems Top-up | Instant delivery, works worldwide | 150 | 2.99
/addcodes 1
ABCD-1234-EFGH
WXYZ-5678-IJKL
```

```
/stats
```

## Local development

```bash
wrangler d1 execute redeem_bot_db --local --file=./schema.sql
wrangler dev
```

`wrangler dev` gives you a local URL, but Telegram can't reach `localhost`
directly — tunnel it (e.g. `cloudflared tunnel --url http://localhost:8787`)
and point `/setup` at the tunnel URL if you want to test the full webhook
flow before deploying. Simpler option: just deploy to a real Worker (`npm
run deploy`) and iterate there — deploys are seconds and free.

## Notes

- **Why webhook instead of polling**: Workers are request-driven with no
  background process, so there's nothing to "poll" from — Telegram calling
  your Worker on every update is the natural fit and is also lower-latency.
- **Security**: the `/webhook` route checks the
  `X-Telegram-Bot-Api-Secret-Token` header against your `WEBHOOK_SECRET`, so
  no one else can POST fake payment confirmations to your bot.
- **Refunds**: Stars purchases can be refunded via the Bot API's
  `refundStarPayment` method — add a small admin handler for it the same
  way `/stats` was added, if you need it.
- **Scaling beyond free tier**: if you outgrow D1's free quota, the paid D1
  tier is inexpensive and requires no code changes — just billing.
