-- Meme candidate detection + runs
CREATE TABLE IF NOT EXISTS meme_candidates (
  id uuid PRIMARY KEY,
  mint text NOT NULL,
  detected_at timestamptz DEFAULT now(),
  status text DEFAULT 'new', -- new, probing, main_buy, completed, failed
  meta jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS meme_runs (
  id uuid PRIMARY KEY,
  candidate_id uuid REFERENCES meme_candidates(id) ON DELETE CASCADE,
  user_id uuid,
  phase text,
  created_at timestamptz DEFAULT now(),
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_meme_candidates_status ON meme_candidates(status);
