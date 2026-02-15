# Coin Hunter — Monorepo

Minimal scaffold implementing Coin Hunter v1 per construction.md. Contains:
- `apps/api-core` — main API (users, wallets, trades, EA endpoints)
- `apps/engine-solana` — solana execution worker (Jupiter primary placeholder)
- `apps/engine-forex` — forex risk worker
- `apps/bot-telegram` — Telegram UI
- `packages/shared` — DB, encryption, audit helpers
- `infra` — docker-compose, migrations, backup/migrate scripts

Quick start (requires `pnpm`, `docker`, `psql`):

```bash
cp .env.example .env
pnpm install
sh infra/migrate.sh
docker-compose -f infra/docker-compose.yml up --build
```
# oooo