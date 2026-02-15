-- Withdrawals table to track user withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  wallet_id uuid REFERENCES wallets(id),
  amount_usd numeric,
  destination text,
  status text DEFAULT 'requested', -- requested | processing | processed | failed
  txid text,
  error text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);
