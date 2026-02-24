-- Weather Strategy Runs table
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

create table if not exists weather_strategy_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Market info (manual input)
  market_url text not null,
  market_title text not null,
  resolution_time timestamptz not null,

  -- Location
  location_text text not null,
  lat numeric,
  lon numeric,

  -- Rule
  rule_type text not null check (rule_type in ('above_below', 'range')),
  threshold_low numeric,
  threshold_high numeric,

  -- Market pricing
  yes_price numeric not null,
  no_price numeric not null,
  fee_bps int not null default 0,
  slippage_bps int not null default 0,

  -- User inputs
  base_size_usd numeric not null default 0,
  user_confidence int not null default 50,
  sigma_temp numeric not null default 1.5,

  -- Forecast
  forecast_source text not null default 'open-meteo',
  forecast_snapshot jsonb,

  -- Computed outputs
  model_prob numeric,
  market_implied_prob numeric,
  edge numeric,
  recommendation text check (recommendation in ('BUY_YES', 'BUY_NO', 'NO_TRADE')),
  trade_plan jsonb,

  -- Optional AI summary
  ai_summary text,

  -- Backtest results (populated after resolution)
  actual_temp numeric,
  resolved_yes boolean,
  pnl numeric,
  backtested_at timestamptz
);

-- Index for listing runs by creation time
create index if not exists idx_runs_created_at on weather_strategy_runs (created_at desc);

-- Enable RLS (but allow all for MVP — no auth required)
alter table weather_strategy_runs enable row level security;

-- Allow all operations for MVP (no auth)
-- Uses DO block so it's safe to re-run
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'weather_strategy_runs'
    and policyname = 'Allow all for MVP'
  ) then
    create policy "Allow all for MVP" on weather_strategy_runs
      for all using (true) with check (true);
  end if;
end
$$;
