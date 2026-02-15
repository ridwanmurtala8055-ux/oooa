# Security

- Wallets are encrypted with AES-256-GCM using `WALLET_MASTER_KEY` from environment.
- Action PINs use Argon2id with an optional `PIN_HASH_PEPPER` environment secret.
- Idempotency enforced via `idempotency_keys` table to prevent double execution.
- Audit logs capture state-changing actions in `audit_logs`.
- Do not store secrets in the repository; use environment or a secrets manager.
