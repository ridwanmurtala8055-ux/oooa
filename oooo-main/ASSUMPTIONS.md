This implementation is a minimal, production-oriented scaffold implementing the Coin Hunter architecture defined in construction.md.

Assumptions made for v1 scaffold:
- Real Jupiter/Raydium/Jito integrations are replaced with deterministic placeholders/simulations in the engine worker; integration points are clearly marked.
- Payments processing (on-chain verification) is out of scope for the initial scaffold; payment records and subscription activation endpoints exist.
- Telegram acts as UI only; the bot sends commands to API which performs logic.
- Redis and advanced queuing are optional; this scaffold uses PostgreSQL for persistence and simple polling workers.
- Secrets must be provided via environment variables: `DATABASE_URL`, `WALLET_MASTER_KEY`, `PIN_HASH_PEPPER`, `TELEGRAM_BOT_TOKEN`.
