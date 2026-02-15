-- User financials for profit buffer and trading capital
CREATE TABLE IF NOT EXISTS user_financials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trading_capital numeric DEFAULT 0,
  reserve_buffer numeric DEFAULT 0,
  profit_buffer_enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
