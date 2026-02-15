# Deployment Notes

1. Provide environment variables: `DATABASE_URL`, `WALLET_MASTER_KEY`, `PIN_HASH_PEPPER`, `TELEGRAM_BOT_TOKEN`.
2. Run migrations: `sh infra/migrate.sh`.
3. Start services: `docker-compose -f infra/docker-compose.yml up --build` or run services individually with `pnpm --filter ... run dev`.

For production, replace the simulation engines with real Jupiter v6 SDK integrations, connect a Redis-backed queue, and run workers under process managers.
