# Coin Hunter Assumptions

1. **Telegram API**: The system assumes a valid Telegram Bot Token is provided.
2. **Solana RPC**: Requires a high-performance RPC provider (e.g., Helius, QuickNode) for sniping.
3. **Jupiter API**: Uses Jupiter v6 API for swaps.
4. **Encryption**: MASTER_KEY for AES-256-GCM is managed via environment variables/secrets.
5. **Database**: PostgreSQL is used for all persistent state.
6. **Network**: Solana Mainnet-Beta is the target network.
7. **Forex**: EA bridge assumes standard MT4/MT5 HTTP POST requests.
8. **Jito**: Optional Jito integration for tip-based execution.
