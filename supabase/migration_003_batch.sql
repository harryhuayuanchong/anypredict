-- Batch grouping: link runs from the same event analysis
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

alter table weather_strategy_runs
  add column if not exists batch_id uuid,
  add column if not exists event_slug text;

-- Index for batch queries
create index if not exists idx_runs_batch_id on weather_strategy_runs (batch_id);
