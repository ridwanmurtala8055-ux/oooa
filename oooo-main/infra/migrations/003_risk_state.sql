-- Risk state table to track kill switch and daily loss thresholds
CREATE TABLE IF NOT EXISTS user_risk_states (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kill_switch boolean DEFAULT false,
  daily_loss_usd numeric DEFAULT 0,
  last_reset timestamptz DEFAULT now()
);
