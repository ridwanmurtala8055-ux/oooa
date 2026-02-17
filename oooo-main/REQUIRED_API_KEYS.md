# Required API Keys & Secrets

To make Coin Hunter fully functional (not mock/simulated), configure these values.

## Required
- `DATABASE_URL`: PostgreSQL connection string.
- `WALLET_MASTER_KEY`: master key for custodial wallet encryption.
- `PIN_HASH_PEPPER`: pepper for PIN hashing.
- `TELEGRAM_BOT_TOKEN`: Telegram bot token from BotFather.
- `SOLANA_RPC_URL`: RPC endpoint for quote/swap execution.
- `EA_SHARED_SECRET`: shared secret between EA clients and server.
- `PAYMENT_RECEIVER_WALLET`: wallet receiving subscriptions.

## Devnet test recommendation
For testing use:
- `SOLANA_CLUSTER=devnet`
- `SOLANA_RPC_URL=https://api.devnet.solana.com` or your Helius devnet endpoint.

## Auto-generate strong secrets
Generate a starter `.env` block with strong secrets:

```bash
npm run env:generate -- \
  --bot-token="<BOT_TOKEN>" \
  --wallet="<RECEIVER_WALLET>" \
  --rpc="https://api.devnet.solana.com"
```

You can provide your own DB password:

```bash
npm run env:generate -- --db-pass="<STRONG_DB_PASSWORD>"
```

## Quick check
After env setup run:

```bash
curl -s http://localhost:8080/admin/readiness | jq .
```

`ok: true` means required env keys are present.
