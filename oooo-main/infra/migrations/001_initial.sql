-- Initial schema for Coin Hunter
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  telegram_id text,
  status text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_pins (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  salt text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  plan text,
  status text,
  active_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  amount_usd numeric,
  method text,
  reference text,
  status text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  label text,
  pubkey text,
  enc_privkey text,
  enc_iv text,
  enc_tag text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

CREATE TABLE IF NOT EXISTS terminal_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  buy_slippage_bps integer DEFAULT 100,
  sell_slippage_bps integer DEFAULT 100,
  exec_mode text DEFAULT 'Normal',
  shield_enabled boolean DEFAULT false,
  confirm_trades boolean DEFAULT true,
  presets_json jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS meme_sniper_profiles (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  profile jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meme_pullback_profiles (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  profile jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forex_profiles (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  profile jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ea_terminals (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  platform text,
  terminal_id text UNIQUE,
  token_hash text,
  status text,
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS sol_trades (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  wallet_id uuid REFERENCES wallets(id),
  mint text,
  side text,
  amount_in_usd numeric,
  amount_out numeric,
  txid text,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sol_trades_user ON sol_trades(user_id);

CREATE TABLE IF NOT EXISTS sol_positions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  wallet_id uuid REFERENCES wallets(id),
  mint text,
  qty numeric,
  entry_price numeric,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  pnl_usd numeric
);

CREATE TABLE IF NOT EXISTS forex_signals (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forex_positions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  symbol text,
  side text,
  lot numeric,
  sl numeric,
  tp numeric,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  pnl numeric
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text,
  payload_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

CREATE TABLE IF NOT EXISTS engine_events (
  id uuid PRIMARY KEY,
  user_id uuid,
  engine text,
  level text,
  message text,
  payload_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  key_value text UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  wallet_id uuid REFERENCES wallets(id),
  type text,
  mint text,
  params jsonb,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);

-- Extensions and helpers
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Initial schema for Coin Hunter
BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  telegram_id text,
  status text,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS security_pins (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  salt text NOT NULL,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  plan text,
  status text,
  active_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  amount_usd numeric,
  method text,
  reference text,
  status text,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  label text,
  pubkey text,
  enc_privkey text,
  enc_iv text,
  enc_tag text,
  is_active boolean,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS terminal_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  buy_slippage_bps int DEFAULT 100,
  sell_slippage_bps int DEFAULT 100,
  exec_mode text DEFAULT 'normal',
  shield_enabled boolean DEFAULT false,
  confirm_trades boolean DEFAULT true,
  presets_json jsonb,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS meme_sniper_profiles (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  profile_json jsonb
);

CREATE TABLE IF NOT EXISTS meme_pullback_profiles (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  profile_json jsonb
);

CREATE TABLE IF NOT EXISTS forex_profiles (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  profile_json jsonb
);

CREATE TABLE IF NOT EXISTS ea_terminals (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  platform text,
  terminal_id text,
  token_hash text,
  status text,
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS sol_trades (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  wallet_id uuid REFERENCES wallets(id),
  mint text,
  side text,
  amount_in_usd numeric,
  txid text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS sol_positions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  wallet_id uuid REFERENCES wallets(id),
  mint text,
  qty numeric,
  entry_price numeric,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  pnl_usd numeric
);

CREATE TABLE IF NOT EXISTS forex_signals (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  symbol text,
  side text,
  lot numeric,
  sl numeric,
  tp numeric,
  idempotency_id text,
  expires_at timestamptz,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS forex_positions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  symbol text,
  side text,
  lot numeric,
  sl numeric,
  tp numeric,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  pnl_usd numeric
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  action text,
  payload_json jsonb,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS engine_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  engine text,
  level text,
  message text,
  payload_json jsonb,
  created_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  key_value text UNIQUE,
  created_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_sol_trades_status ON sol_trades(status);
CREATE INDEX IF NOT EXISTS idx_sol_positions_user ON sol_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

COMMIT;
