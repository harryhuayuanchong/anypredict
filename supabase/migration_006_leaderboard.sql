-- Migration 006: Leaderboard support
-- Adds wallet AI summaries cache and watchlist tables

CREATE TABLE IF NOT EXISTS wallet_ai_summaries (
  wallet_address text PRIMARY KEY,
  data_hash text NOT NULL,
  summary jsonb NOT NULL,
  source text NOT NULL DEFAULT 'rule_based' CHECK (source IN ('model', 'rule_based')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ai_summaries_hash ON wallet_ai_summaries(data_hash);

CREATE TABLE IF NOT EXISTS watchlist_wallets (
  client_id text NOT NULL,
  wallet_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_wallets_client ON watchlist_wallets(client_id);
