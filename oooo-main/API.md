# Coin Hunter API

Key endpoints implemented in this scaffold:

- `GET /health` — health check
- `POST /users` — create user (`{ telegram_id }`)
- `POST /wallets` — create custodial wallet (`{ user_id, label, privkey_b64 }`)
- `POST /trades/sol/buy` — request a SOL trade (idempotency required)
- `POST /ea/poll` — EA poll endpoint for Forex EA
- `POST /ea/report` — EA report from client

All state-changing endpoints write to `audit_logs`.
