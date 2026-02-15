-- Add meta and position linkage to sol_trades for sell handling
ALTER TABLE sol_trades
  ADD COLUMN IF NOT EXISTS position_id uuid REFERENCES sol_positions(id),
  ADD COLUMN IF NOT EXISTS meta jsonb;
