-- Migration 004: Trading support
-- Adds CLOB token identifiers to strategy runs + trade orders table

-- Add CLOB trading identifiers to strategy runs
ALTER TABLE weather_strategy_runs
  ADD COLUMN IF NOT EXISTS clob_token_id_yes text,
  ADD COLUMN IF NOT EXISTS clob_token_id_no text,
  ADD COLUMN IF NOT EXISTS condition_id text,
  ADD COLUMN IF NOT EXISTS neg_risk boolean DEFAULT false;

-- Trade orders table
CREATE TABLE IF NOT EXISTS trade_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Platform
  platform text NOT NULL DEFAULT 'polymarket',
  external_order_id text,

  -- Links
  run_id uuid REFERENCES weather_strategy_runs(id),
  batch_id uuid,

  -- Market identification
  market_id text NOT NULL,
  token_id text NOT NULL,

  -- Order params
  side text NOT NULL DEFAULT 'BUY',
  outcome text NOT NULL CHECK (outcome IN ('YES', 'NO')),
  order_type text NOT NULL DEFAULT 'GTC',
  price numeric NOT NULL,
  size numeric NOT NULL,
  size_usd numeric NOT NULL,

  -- Execution
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','live','matched','filled','cancelled','expired','failed')),
  fill_price numeric,
  fill_size numeric,
  fill_size_usd numeric,

  -- Safety
  dry_run boolean NOT NULL DEFAULT true,
  edge_at_placement numeric,
  model_prob_at_placement numeric,
  market_price_at_placement numeric,

  -- Timestamps
  submitted_at timestamptz,
  filled_at timestamptz,
  cancelled_at timestamptz,

  -- Error tracking
  error_message text,

  -- Raw response
  platform_response jsonb
);

CREATE INDEX IF NOT EXISTS idx_trade_orders_run_id ON trade_orders(run_id);
CREATE INDEX IF NOT EXISTS idx_trade_orders_batch_id ON trade_orders(batch_id);
CREATE INDEX IF NOT EXISTS idx_trade_orders_status ON trade_orders(status);
CREATE INDEX IF NOT EXISTS idx_trade_orders_created_at ON trade_orders(created_at DESC);
