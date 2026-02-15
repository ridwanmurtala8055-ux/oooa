-- Add idempotency key and error code to withdrawals
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_idempotency ON withdrawals(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS error_code text;
