export interface WeatherStrategyRun {
  id: string;
  created_at: string;

  // Market
  market_url: string;
  market_title: string;
  resolution_time: string;

  // Location
  location_text: string;
  lat: number | null;
  lon: number | null;

  // Rule
  rule_type: "above_below" | "range";
  threshold_low: number | null;
  threshold_high: number | null;

  // Market pricing
  yes_price: number;
  no_price: number;
  fee_bps: number;
  slippage_bps: number;

  // User inputs
  base_size_usd: number;
  user_confidence: number;
  sigma_temp: number;

  // Forecast
  forecast_source: string;
  forecast_snapshot: ForecastSnapshot | null;

  // Computed
  model_prob: number | null;
  market_implied_prob: number | null;
  edge: number | null;
  recommendation: "BUY_YES" | "BUY_NO" | "NO_TRADE" | null;
  trade_plan: TradePlan | null;

  // Optional
  ai_summary: string | null;

  // Batch grouping
  batch_id: string | null;
  event_slug: string | null;

  // Backtest
  actual_temp: number | null;
  resolved_yes: boolean | null;
  pnl: number | null;
  backtested_at: string | null;
}

export interface ForecastSnapshot {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly_times: string[];
  hourly_temps: number[];
  target_time: string;
  forecast_temp: number;
  forecast_temp_min: number | null;
  forecast_temp_max: number | null;

  // Ensemble data (combined pool of all models)
  ensemble_members?: number[];       // daily-max temp per ensemble member (all models pooled)
  ensemble_p10?: number;
  ensemble_p50?: number;
  ensemble_p90?: number;
  ensemble_std?: number;             // empirical std from ensemble spread
  ensemble_model?: string;           // label for combined models (e.g., "ecmwf_ifs025+gfs025")
  ensemble_member_count?: number;    // total members across all models
  prob_method?: "ensemble" | "normal"; // how probability was computed

  // Per-model breakdown
  ensemble_models?: EnsembleModelBreakdown[];
  models_agree?: boolean;            // do all models agree on market direction?
}

export interface EnsembleModelBreakdown {
  model: string;                     // e.g., "ecmwf_ifs025"
  members: number[];                 // raw member values
  member_count: number;
  p10: number;
  p50: number;
  p90: number;
  std: number;
  prob: number;                      // per-model probability for this market condition
}

export interface TradePlan {
  recommended_side: "BUY_YES" | "BUY_NO" | "NO_TRADE";
  rationale: string[];
  assumptions: string[];
  invalidated_if: string[];
  suggested_size_usd: number;
  kelly_fraction?: number;           // Kelly optimal fraction
  kelly_size_usd?: number;           // Kelly-based size
  half_kelly_size_usd?: number;      // Conservative half-Kelly
}

export interface ComputeInput {
  market_url: string;
  market_title: string;
  resolution_time: string;
  location_text: string;
  lat: number;
  lon: number;
  rule_type: "above_below" | "range";
  threshold_low: number | null;
  threshold_high: number | null;
  yes_price: number;
  no_price: number;
  fee_bps: number;
  slippage_bps: number;
  base_size_usd: number;
  user_confidence: number;
  sigma_temp: number;
  forecast_source: string;
  time_window_hours: number;
  min_edge: number;
}

export interface ComputeResult {
  forecast_snapshot: ForecastSnapshot;
  model_prob: number;
  market_implied_prob: number;
  edge: number;
  recommendation: "BUY_YES" | "BUY_NO" | "NO_TRADE";
  trade_plan: TradePlan;
}

// Backtest
export interface BacktestResult {
  actual_temp: number;
  resolved_yes: boolean;
  pnl: number;
  forecast_temp: number;
  forecast_error: number;
}

/* ═══════════════════════════════════════════════════════
   Batch compute types
   ═══════════════════════════════════════════════════════ */

export interface SubMarketInput {
  id: string;
  question: string;
  rule_type: "above_below" | "range";
  threshold_low: number | null;
  threshold_high: number | null;
  yes_price: number;
  no_price: number;
  label: string;
}

export interface BatchComputeInput {
  // Event-level (shared)
  event_url: string;
  event_title: string;
  event_slug: string;
  resolution_time: string;
  location_text: string;
  lat: number;
  lon: number;

  // Shared config
  fee_bps: number;
  slippage_bps: number;
  base_size_usd: number;
  user_confidence: number;
  sigma_temp: number;
  forecast_source: string;
  time_window_hours: number;
  min_edge: number;

  // Per-sub-market data
  sub_markets: SubMarketInput[];
}

export interface SubMarketResult {
  sub_market_id: string;
  label: string;
  question: string;
  run_id: string;
  model_prob: number;
  market_implied_prob: number;
  edge: number;
  recommendation: "BUY_YES" | "BUY_NO" | "NO_TRADE";
  kelly_fraction: number;
  suggested_size_usd: number;
  yes_price: number;
  no_price: number;
}

export interface PreFetchedWeatherData {
  forecast: ForecastSnapshot;
  multiModel: MultiModelResult | null;
  targetDate: string;
}

export interface MultiModelResult {
  pooled_members: number[];
  per_model: SingleModelResult[];
  total_members: number;
  models_label: string;
}

export interface SingleModelResult {
  members: number[];
  model: string;
  member_count: number;
}
