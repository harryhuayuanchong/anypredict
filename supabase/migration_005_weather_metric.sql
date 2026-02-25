-- Migration 005: Multi-weather-category support
-- Add weather_metric and unit columns to strategy runs

ALTER TABLE weather_strategy_runs
  ADD COLUMN IF NOT EXISTS weather_metric text DEFAULT 'temperature',
  ADD COLUMN IF NOT EXISTS weather_unit text DEFAULT '°C',
  ADD COLUMN IF NOT EXISTS actual_value numeric;

-- Backfill existing rows
UPDATE weather_strategy_runs
SET weather_metric = 'temperature',
    weather_unit = '°C',
    actual_value = actual_temp
WHERE weather_metric IS NULL;

-- Index for filtering by metric type
CREATE INDEX IF NOT EXISTS idx_runs_weather_metric
  ON weather_strategy_runs (weather_metric);
