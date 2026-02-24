-- Run this if you already have the table from migration.sql
-- Adds backtest columns to existing table

alter table weather_strategy_runs
  add column if not exists actual_temp numeric,
  add column if not exists resolved_yes boolean,
  add column if not exists pnl numeric,
  add column if not exists backtested_at timestamptz;
