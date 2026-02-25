import type {
  BatchComputeInput,
  ComputeInput,
  ComputeResult,
  EnsembleModelBreakdown,
  ForecastSnapshot,
  MultiModelResult,
  PreFetchedWeatherData,
  SingleModelResult,
  TradePlan,
} from "./types";
import {
  type WeatherVariableConfig,
  WEATHER_CONFIGS,
  getConfigForMetric,
} from "./weather-config";
import { fetchEarthquakeData } from "./earthquake";
import { fetchGistempClimateData } from "./gistemp";

/* ═══════════════════════════════════════════════════════
   Math helpers
   ═══════════════════════════════════════════════════════ */

/** Normal CDF approximation (Abramowitz and Stegun) */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/** P(temp > threshold) using normal distribution */
function probAboveThreshold(mean: number, sigma: number, threshold: number): number {
  return 1 - normalCDF((threshold - mean) / sigma);
}

/** P(low ≤ temp ≤ high) using normal distribution */
function probInRange(mean: number, sigma: number, low: number, high: number): number {
  return normalCDF((high - mean) / sigma) - normalCDF((low - mean) / sigma);
}

/** Standard deviation of an array */
function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/** Percentile of a sorted array (linear interpolation) */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* ═══════════════════════════════════════════════════════
   Multi-model ensemble forecast fetching
   ═══════════════════════════════════════════════════════ */

/**
 * Fetch ensemble daily-max from a single model.
 * Returns null if the model fails or returns insufficient data.
 */
async function fetchSingleModelEnsemble(
  lat: number,
  lon: number,
  targetDate: string,
  model: string,
  config: WeatherVariableConfig = WEATHER_CONFIGS.temperature
): Promise<SingleModelResult | null> {
  try {
    const ensVar = config.ensembleDailyVar;
    const memberPrefix = config.ensembleMemberPrefix;

    const url = new URL("https://ensemble-api.open-meteo.com/v1/ensemble");
    url.searchParams.set("latitude", lat.toString());
    url.searchParams.set("longitude", lon.toString());
    url.searchParams.set("daily", ensVar);
    url.searchParams.set("start_date", targetDate);
    url.searchParams.set("end_date", targetDate);
    url.searchParams.set("models", model);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;

    const data = await res.json();
    const daily = data.daily;
    if (!daily) return null;

    const members: number[] = [];
    for (const key of Object.keys(daily)) {
      if (key.startsWith(`${memberPrefix}_member`)) {
        const vals = daily[key] as number[];
        if (vals && vals.length > 0 && vals[0] != null) {
          members.push(vals[0]);
        }
      }
    }

    // Also include the control run if present
    if (daily[ensVar]) {
      const ctrl = daily[ensVar] as number[];
      if (ctrl.length > 0 && ctrl[0] != null && !members.includes(ctrl[0])) {
        members.push(ctrl[0]);
      }
    }

    if (members.length >= 3) {
      return { members, model, member_count: members.length };
    }
  } catch {
    // Model failed
  }
  return null;
}

/**
 * Fetch ensemble data from ALL available models in parallel, then pool results.
 * Queries 5 models: ECMWF IFS (51) + GFS (31) + ECMWF AIFS (51) + ICON (40) + GEM (21).
 * Returns up to ~194 pooled members from genuinely different model physics.
 * Models with shorter forecast ranges (e.g. ICON 7.5d) may return null for distant dates.
 */
export async function fetchMultiModelEnsemble(
  lat: number,
  lon: number,
  targetDate: string,
  config: WeatherVariableConfig = WEATHER_CONFIGS.temperature
): Promise<MultiModelResult | null> {
  // Earthquake uses synthetic ensemble from USGS, not Open-Meteo
  if (config.dataSource === "usgs") return null;

  const modelIds = [
    "ecmwf_ifs025",   // ECMWF IFS — 51 members, 15-day range
    "gfs025",          // GFS — 31 members, 10-day range
    "ecmwf_aifs025",   // ECMWF AIFS (AI-enhanced) — 51 members, 15-day range
    "icon_global",     // DWD ICON — 40 members, 7.5-day range
    "gem_global",      // Canadian GEM — 21 members, 16-day range
  ];

  // Fetch all models in parallel
  const results = await Promise.all(
    modelIds.map((m) => fetchSingleModelEnsemble(lat, lon, targetDate, m, config))
  );

  // Filter out failed models
  const successful = results.filter((r): r is SingleModelResult => r !== null);

  if (successful.length === 0) return null;

  // Pool all members
  const pooled: number[] = [];
  for (const model of successful) {
    pooled.push(...model.members);
  }

  if (pooled.length < 5) return null;

  return {
    pooled_members: pooled,
    per_model: successful,
    total_members: pooled.length,
    models_label: successful.map((m) => m.model).join("+"),
  };
}

/* ═══════════════════════════════════════════════════════
   Probability computation
   ═══════════════════════════════════════════════════════ */

/**
 * Empirical probability from ensemble members (Laplace smoothing).
 * More robust than assumed normal — uses the real forecast distribution.
 */
function ensembleProbability(
  members: number[],
  ruleType: "above_below" | "range",
  thresholdLow: number | null,
  thresholdHigh: number | null
): number {
  const n = members.length;
  if (n === 0) return 0.5;

  let hits = 0;
  for (const temp of members) {
    if (ruleType === "above_below") {
      if (thresholdLow != null && thresholdHigh == null) {
        // "≥ X" market
        if (temp >= thresholdLow) hits++;
      } else if (thresholdHigh != null && thresholdLow == null) {
        // "≤ X" market
        if (temp <= thresholdHigh) hits++;
      } else {
        // Both set — treat threshold_high as upper bound
        const threshold = thresholdHigh ?? thresholdLow ?? 0;
        if (temp >= threshold) hits++;
      }
    } else {
      // Range market
      const low = thresholdLow ?? -Infinity;
      const high = thresholdHigh ?? Infinity;
      if (temp >= low && temp <= high) hits++;
    }
  }

  // Laplace smoothing: (hits + 1) / (n + 2)
  return (hits + 1) / (n + 2);
}

/**
 * Normal distribution probability (fallback when ensemble is unavailable)
 */
function normalProbability(
  mean: number,
  sigma: number,
  ruleType: "above_below" | "range",
  thresholdLow: number | null,
  thresholdHigh: number | null
): number {
  if (ruleType === "above_below") {
    if (thresholdLow != null && thresholdHigh == null) {
      return probAboveThreshold(mean, sigma, thresholdLow);
    } else if (thresholdHigh != null && thresholdLow == null) {
      return 1 - probAboveThreshold(mean, sigma, thresholdHigh);
    } else {
      const threshold = thresholdHigh ?? thresholdLow ?? 0;
      return probAboveThreshold(mean, sigma, threshold);
    }
  } else {
    const low = thresholdLow ?? -Infinity;
    const high = thresholdHigh ?? Infinity;
    return probInRange(mean, sigma, low, high);
  }
}

/* ═══════════════════════════════════════════════════════
   Kelly criterion for prediction markets
   ═══════════════════════════════════════════════════════ */

/**
 * Kelly fraction for a binary prediction market.
 *
 * For BUY YES at price P:
 *   Win payout = (1 - P) per unit, Loss = -P per unit
 *   kelly = (p*(1-P) - (1-p)*P) / ((1-P)*P) = (p - P) / (1 - P)
 *   (simplified for binary where payout is 1:P odds)
 *
 * For BUY NO at price (1-P):
 *   kelly = ((1-p) - (1-P)) / P = (P - p) / P
 *
 * Returns fraction of bankroll to wager. Capped at 25% for safety.
 */
function kellyFraction(
  modelProb: number,
  marketPrice: number,
  side: "BUY_YES" | "BUY_NO" | "NO_TRADE",
  feeFraction: number
): number {
  if (side === "NO_TRADE") return 0;

  let kelly: number;
  if (side === "BUY_YES") {
    // Adjusted market price with fees
    const effectivePrice = marketPrice + feeFraction;
    if (effectivePrice >= 1) return 0;
    kelly = (modelProb - effectivePrice) / (1 - effectivePrice);
  } else {
    // BUY NO
    const effectivePrice = (1 - marketPrice) + feeFraction;
    if (effectivePrice >= 1) return 0;
    kelly = ((1 - modelProb) - effectivePrice) / (1 - effectivePrice);
  }

  // Cap at 25% and floor at 0
  return Math.max(0, Math.min(0.25, kelly));
}

/* ═══════════════════════════════════════════════════════
   Forecast fetching (deterministic)
   ═══════════════════════════════════════════════════════ */

/**
 * Fetch deterministic forecast from Open-Meteo for the given location and time
 */
export async function fetchForecast(
  lat: number,
  lon: number,
  targetTime: string,
  windowHours: number,
  config: WeatherVariableConfig = WEATHER_CONFIGS.temperature
): Promise<ForecastSnapshot> {
  const hourlyVar = config.forecastHourlyVar;
  const target = new Date(targetTime);
  const startDate = new Date(target.getTime() - windowHours * 3600 * 1000);
  const endDate = new Date(target.getTime() + windowHours * 3600 * 1000);

  const formatDate = (d: Date) => d.toISOString().split("T")[0];

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("hourly", hourlyVar);
  url.searchParams.set("start_date", formatDate(startDate));
  url.searchParams.set("end_date", formatDate(endDate));
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText} for ${url.toString()}`);
  }

  const data = await res.json();
  const times: string[] = data.hourly?.time ?? [];
  const values: number[] = data.hourly?.[hourlyVar] ?? [];

  if (times.length === 0 || values.length === 0) {
    throw new Error(
      `No forecast data returned from Open-Meteo for ${hourlyVar} at (${lat}, ${lon}) on ${formatDate(startDate)}–${formatDate(endDate)}. The date may be outside the forecast range.`
    );
  }

  // Find the closest hour to the target time
  const targetMs = target.getTime();
  let closestIdx = 0;
  let closestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - targetMs);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIdx = i;
    }
  }

  // Get window values
  const windowValues = values.filter((_, i) => {
    const t = new Date(times[i]).getTime();
    return (
      t >= target.getTime() - windowHours * 3600 * 1000 &&
      t <= target.getTime() + windowHours * 3600 * 1000
    );
  });

  // For cumulative metrics (rain, snow), the forecast_value is the sum over the window;
  // for instantaneous metrics (temp, wind), it's the max over the window.
  let forecastValue: number;
  if (config.dailyAggregation === "sum") {
    forecastValue = windowValues.reduce((s, v) => s + (v ?? 0), 0);
  } else {
    forecastValue = values[closestIdx];
  }

  return {
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
    hourly_times: times,
    hourly_temps: values, // kept as 'hourly_temps' for backward compat
    target_time: times[closestIdx],
    forecast_temp: values[closestIdx], // backward compat
    forecast_temp_min: windowValues.length > 0 ? Math.min(...windowValues) : null,
    forecast_temp_max: windowValues.length > 0 ? Math.max(...windowValues) : null,
    forecast_value: forecastValue,
    hourly_values: values,
    weather_metric: config.metric,
  };
}

/* ═══════════════════════════════════════════════════════
   Pre-fetch weather data (shared across sub-markets)
   ═══════════════════════════════════════════════════════ */

/**
 * Fetch all weather data (deterministic + ensemble) for a location and date.
 * Call ONCE, then pass to computeStrategyFromData for each sub-market.
 */
export async function fetchWeatherData(
  lat: number,
  lon: number,
  resolutionTime: string,
  timeWindowHours: number,
  config: WeatherVariableConfig = WEATHER_CONFIGS.temperature,
  eventTitle: string = ""
): Promise<PreFetchedWeatherData> {
  // Earthquake uses a completely separate data pipeline
  if (config.dataSource === "usgs") {
    try {
      return await fetchEarthquakeData(lat, lon, resolutionTime);
    } catch (err) {
      throw new Error(
        `USGS earthquake data fetch failed for (${lat}, ${lon}): ${err instanceof Error ? err.message : err}`
      );
    }
  }

  // NASA GISS climate anomaly — global index, no location needed
  if (config.dataSource === "nasa-giss") {
    try {
      return await fetchGistempClimateData(resolutionTime, eventTitle);
    } catch (err) {
      throw new Error(
        `NASA GISS climate data fetch failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  let forecast: ForecastSnapshot;
  try {
    forecast = await fetchForecast(lat, lon, resolutionTime, timeWindowHours, config);
  } catch (err) {
    throw new Error(
      `Weather forecast fetch failed for (${lat}, ${lon}) at ${resolutionTime} [${config.metric}]: ${err instanceof Error ? err.message : err}`
    );
  }

  const targetDate = resolutionTime.split("T")[0];

  let multiModel: MultiModelResult | null = null;
  try {
    multiModel = await fetchMultiModelEnsemble(lat, lon, targetDate, config);
  } catch {
    // Ensemble failed — will fall back to normal distribution
  }

  return { forecast, multiModel, targetDate };
}

/* ═══════════════════════════════════════════════════════
   Strategy computation (from pre-fetched data)
   ═══════════════════════════════════════════════════════ */

/**
 * Compute strategy for a single market using pre-fetched weather data.
 * Pure computation — no API calls. Safe to call N times in a loop
 * for batch analysis with the same weather data.
 */
export function computeStrategyFromData(
  input: ComputeInput,
  weatherData: PreFetchedWeatherData,
  config: WeatherVariableConfig = WEATHER_CONFIGS.temperature
): ComputeResult {
  // Deep-clone forecast so each sub-market gets its own copy
  // (we mutate it by adding per-threshold ensemble breakdowns)
  const forecast: ForecastSnapshot = structuredClone(weatherData.forecast);
  const multiModel = weatherData.multiModel;

  const unit = config.primaryUnit;
  const mean = forecast.forecast_value ?? forecast.forecast_temp;
  const sigma = input.sigma_temp;

  // 1. Compute model probability
  let modelProb: number;
  let probMethod: "ensemble" | "normal";

  if (multiModel && multiModel.pooled_members.length >= 5) {
    modelProb = ensembleProbability(
      multiModel.pooled_members,
      input.rule_type,
      input.threshold_low,
      input.threshold_high
    );
    probMethod = "ensemble";
  } else {
    modelProb = normalProbability(
      mean,
      sigma,
      input.rule_type,
      input.threshold_low,
      input.threshold_high
    );
    probMethod = "normal";
  }

  // Clamp to [0.01, 0.99]
  modelProb = Math.max(0.01, Math.min(0.99, modelProb));

  // 2. Enrich forecast snapshot with ensemble data
  if (multiModel) {
    const sorted = [...multiModel.pooled_members].sort((a, b) => a - b);
    forecast.ensemble_members = multiModel.pooled_members;
    forecast.ensemble_p10 = Math.round(percentile(sorted, 10) * 10) / 10;
    forecast.ensemble_p50 = Math.round(percentile(sorted, 50) * 10) / 10;
    forecast.ensemble_p90 = Math.round(percentile(sorted, 90) * 10) / 10;
    forecast.ensemble_std = Math.round(std(multiModel.pooled_members) * 100) / 100;
    forecast.ensemble_model = multiModel.models_label;
    forecast.ensemble_member_count = multiModel.total_members;

    // Per-model breakdown (probabilities are threshold-specific)
    const perModelBreakdowns: EnsembleModelBreakdown[] = multiModel.per_model.map((m) => {
      const mSorted = [...m.members].sort((a, b) => a - b);
      const mProb = ensembleProbability(
        m.members,
        input.rule_type,
        input.threshold_low,
        input.threshold_high
      );
      return {
        model: m.model,
        members: m.members,
        member_count: m.member_count,
        p10: Math.round(percentile(mSorted, 10) * 10) / 10,
        p50: Math.round(percentile(mSorted, 50) * 10) / 10,
        p90: Math.round(percentile(mSorted, 90) * 10) / 10,
        std: Math.round(std(m.members) * 100) / 100,
        prob: Math.round(mProb * 10000) / 10000,
      };
    });
    forecast.ensemble_models = perModelBreakdowns;

    // Check if models agree on direction
    if (perModelBreakdowns.length >= 2) {
      const allAboveHalf = perModelBreakdowns.every((m) => m.prob > 0.5);
      const allBelowHalf = perModelBreakdowns.every((m) => m.prob < 0.5);
      forecast.models_agree = allAboveHalf || allBelowHalf;
    }
  }
  forecast.prob_method = probMethod;

  // 3. Market implied probability & edge
  const feeFraction = input.fee_bps / 10000;
  const slippageFraction = input.slippage_bps / 10000;
  const marketImpliedProb = input.yes_price;
  const totalCost = feeFraction + slippageFraction;
  const edge = modelProb - marketImpliedProb - totalCost;

  // 4. Recommendation
  let recommendation: "BUY_YES" | "BUY_NO" | "NO_TRADE";
  const minEdge = input.min_edge;

  if (edge > minEdge) {
    recommendation = "BUY_YES";
  } else if (edge < -minEdge) {
    recommendation = "BUY_NO";
  } else {
    recommendation = "NO_TRADE";
  }

  // 5. Kelly criterion position sizing
  const kelly = kellyFraction(modelProb, input.yes_price, recommendation, totalCost);
  const bankroll = input.base_size_usd;
  const kellySize = Math.round(bankroll * kelly * 100) / 100;
  const halfKellySize = Math.round(kellySize * 0.5 * 100) / 100;

  const confidenceScale = input.user_confidence / 100;
  const suggestedSize =
    recommendation !== "NO_TRADE"
      ? Math.round(halfKellySize * confidenceScale * 100) / 100
      : 0;

  // 6. Build threshold description for rationale
  const metricLabel = config.metric === "temperature" ? "temp" : config.metric;
  let thresholdDesc: string;
  if (input.rule_type === "above_below") {
    if (input.threshold_low != null && input.threshold_high == null) {
      thresholdDesc = `${metricLabel} ≥ ${input.threshold_low}${unit}`;
    } else if (input.threshold_high != null && input.threshold_low == null) {
      thresholdDesc = `${metricLabel} ≤ ${input.threshold_high}${unit}`;
    } else {
      thresholdDesc = `${metricLabel} > ${input.threshold_high ?? input.threshold_low}${unit}`;
    }
  } else {
    thresholdDesc = `${input.threshold_low}${unit} ≤ ${metricLabel} ≤ ${input.threshold_high}${unit}`;
  }

  // 7. Build trade plan with enriched rationale
  const rationale: string[] = [
    `Forecast ${metricLabel} at ${forecast.target_time}: ${mean.toFixed(1)}${unit}`,
  ];

  if (multiModel) {
    rationale.push(
      `Multi-model ensemble: ${multiModel.total_members} members from ${multiModel.per_model.length} models (${multiModel.models_label})`
    );
    for (const mb of forecast.ensemble_models ?? []) {
      const modelLabel = mb.model === "ecmwf_ifs025" ? "ECMWF" : mb.model === "gfs025" ? "GFS" : mb.model;
      rationale.push(
        `  ${modelLabel} (${mb.member_count}m): P50=${mb.p50}${unit}, σ=${mb.std}${unit} → P(${thresholdDesc}) = ${(mb.prob * 100).toFixed(1)}%`
      );
    }
    rationale.push(
      `Combined: P10=${forecast.ensemble_p10}${unit}, P50=${forecast.ensemble_p50}${unit}, P90=${forecast.ensemble_p90}${unit}, σ=${forecast.ensemble_std}${unit}`,
      `Pooled probability: P(${thresholdDesc}) = ${(modelProb * 100).toFixed(1)}%` +
        (forecast.models_agree != null ? (forecast.models_agree ? " (models agree)" : " (models DISAGREE)") : "")
    );
  } else {
    rationale.push(
      `Probability (normal, σ=${sigma}${unit}): P(${thresholdDesc}) = ${(modelProb * 100).toFixed(1)}%`
    );
  }

  rationale.push(
    `Market implied: ${(marketImpliedProb * 100).toFixed(1)}%`,
    `Edge: ${(edge * 100).toFixed(2)}% (after ${input.fee_bps}bps fees + ${input.slippage_bps}bps slippage)`
  );

  if (recommendation !== "NO_TRADE") {
    rationale.push(
      `Kelly fraction: ${(kelly * 100).toFixed(1)}% → Full Kelly: $${kellySize.toFixed(2)}, Half Kelly: $${halfKellySize.toFixed(2)}`,
      `Suggested size (half-Kelly × ${input.user_confidence}% confidence): $${suggestedSize.toFixed(2)}`
    );
  } else {
    rationale.push(
      `Edge below min threshold of ${(minEdge * 100).toFixed(1)}% — no trade recommended`
    );
  }

  const dataSourceLabel = config.dataSource === "usgs" ? "USGS historical data" : "Open-Meteo forecast";
  const tradePlan: TradePlan = {
    recommended_side: recommendation,
    rationale,
    assumptions: [
      multiModel
        ? `Probability from ${multiModel.total_members}-member multi-model ensemble (${multiModel.models_label}) — real distribution from ${multiModel.per_model.length} independent models`
        : `${config.category} follows normal distribution with mean=${mean.toFixed(1)}${unit}, σ=${sigma}${unit}`,
      `${dataSourceLabel} is reasonably accurate for this time window`,
      `Market is liquid enough to execute at YES=${input.yes_price}/NO=${input.no_price}`,
      `No major ${config.category.toLowerCase()} system changes expected before resolution`,
      `Position sized with half-Kelly criterion for conservative risk management`,
    ],
    invalidated_if: [
      `Forecast updates push mean ${metricLabel} across the ${thresholdDesc} boundary`,
      `Market spread widens significantly (> 5% from current levels)`,
      `Liquidity drops or becomes insufficient for position size`,
      `Severe weather advisory issued for the location that changes outlook`,
      `Time to resolution < 1 hour and forecast has shifted`,
    ],
    suggested_size_usd: suggestedSize,
    kelly_fraction: Math.round(kelly * 10000) / 10000,
    kelly_size_usd: kellySize,
    half_kelly_size_usd: halfKellySize,
  };

  return {
    forecast_snapshot: forecast,
    model_prob: Math.round(modelProb * 10000) / 10000,
    market_implied_prob: Math.round(marketImpliedProb * 10000) / 10000,
    edge: Math.round(edge * 10000) / 10000,
    recommendation,
    trade_plan: tradePlan,
  };
}

/* ═══════════════════════════════════════════════════════
   Single strategy computation (backward compatible)
   ═══════════════════════════════════════════════════════ */

/**
 * Compute strategy for a single market.
 * Fetches forecast + ensemble, then delegates to computeStrategyFromData.
 */
export async function computeStrategy(input: ComputeInput): Promise<ComputeResult> {
  const config = getConfigForMetric(input.weather_metric ?? "temperature");
  const weatherData = await fetchWeatherData(
    input.lat,
    input.lon,
    input.resolution_time,
    input.time_window_hours,
    config,
    input.market_title
  );
  return computeStrategyFromData(input, weatherData, config);
}

/* ═══════════════════════════════════════════════════════
   Batch strategy computation
   ═══════════════════════════════════════════════════════ */

/**
 * Compute strategy for ALL sub-markets of an event in one shot.
 * Fetches forecast + ensemble ONCE, then computes probabilities
 * for each sub-market against the same weather data.
 */
export async function computeBatch(
  input: BatchComputeInput
): Promise<ComputeResult[]> {
  // Derive config from weather_metric (defaults to temperature)
  const config = getConfigForMetric(input.weather_metric ?? "temperature");

  // 1. Fetch all weather data ONCE (shared location + date)
  const weatherData = await fetchWeatherData(
    input.lat,
    input.lon,
    input.resolution_time,
    input.time_window_hours,
    config,
    input.event_title
  );

  // 2. Compute for each sub-market (synchronous — no API calls)
  return input.sub_markets.map((sm) => {
    const singleInput: ComputeInput = {
      market_url: input.event_url,
      market_title: `${input.event_title} — ${sm.question}`,
      resolution_time: input.resolution_time,
      location_text: input.location_text,
      lat: input.lat,
      lon: input.lon,
      rule_type: sm.rule_type,
      threshold_low: sm.threshold_low,
      threshold_high: sm.threshold_high,
      yes_price: sm.yes_price,
      no_price: sm.no_price,
      fee_bps: input.fee_bps,
      slippage_bps: input.slippage_bps,
      base_size_usd: input.base_size_usd,
      user_confidence: input.user_confidence,
      sigma_temp: input.sigma_temp,
      forecast_source: input.forecast_source,
      time_window_hours: input.time_window_hours,
      min_edge: input.min_edge,
      weather_metric: input.weather_metric,
    };
    return computeStrategyFromData(singleInput, weatherData, config);
  });
}
