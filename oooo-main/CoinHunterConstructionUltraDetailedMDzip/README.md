# Coin Hunter

Production-ready multi-chain trading system.

## Setup
1. `npm install`
2. Configure `.env` with `TELEGRAM_BOT_TOKEN`, `SOLANA_RPC`, `DATABASE_URL`.
3. `npm run dev`

## Architecture
- `apps/api-core`: Central management and risk engine.
- `apps/bot-telegram`: User interface.
- `apps/engine-solana`: Solana execution.
- `apps/engine-forex`: Forex EA bridge.
- `packages/shared`: Shared encryption and types.
