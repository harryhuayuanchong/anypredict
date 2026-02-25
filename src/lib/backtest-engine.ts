/**
 * Strategy Backtest Engine — Multi-Metric
 *
 * Supports backtesting across all Climate & Science metrics:
 * - Temperature (Open-Meteo Archive)
 * - Snowfall (Open-Meteo Archive)
 * - Rainfall (Open-Meteo Archive)
 * - Wind Speed (Open-Meteo Archive)
 * - Earthquake (USGS Historical)
 */

import type {
  BacktestOutput,
  ScenarioResult,
  ScenarioMetrics,
  DailyPnl,
  MonthlyPnl,
  CityBreakdown,
  TradeTypeBreakdown,
  CalibrationBucket,
  EdgeHistogramBucket,
  StrategyTradeResult,
} from "./types";
import type { WeatherMetric } from "./weather-config";

// ═══════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════

const DEFAULT_START = "2025-08-15";
const DEFAULT_END = "2026-02-15";
const CLIMATE_START = "2019-01-01";
const CLIMATE_END = "2024-12-31";

const DEFAULT_FEE_BPS = 100;
const DEFAULT_SLIPPAGE_BPS = 50;
const BASE_SIZE_USD = 100;
const MIN_EDGE = 0.03;
const USER_CONFIDENCE = 70;
const MAX_TRADES_PER_EVENT = 3;

/** User-configurable parameters passed from the frontend */
export interface BacktestConfig {
  start?: string;
  end?: string;
  feeBps?: number;
  slippageBps?: number;
  baseSizeUsd?: number;
  confidence?: number;
  metric?: WeatherMetric;
}

// ═══════════════════════════════════════════════════════════
// Types (internal)
// ═══════════════════════════════════════════════════════════

interface Bucket {
  label: string;
  rule_type: "above_below" | "range";
  threshold_low: number | null;  // in primary unit
  threshold_high: number | null; // in primary unit
}

interface Trade {
  date: string;
  city: string;
  bucket_label: string;
  side: "BUY_YES" | "BUY_NO";
  model_prob: number;
  market_price: number;
  edge: number;
  kelly: number;
  size_usd: number;
}

interface Location {
  name: string;
  lat: number;
  lon: number;
}

interface MetricProfile {
  metric: WeatherMetric;
  label: string;
  locations: Location[];
  archiveVar: string;
  primaryUnit: string;
  forecastBiasStd: number;
  ecmwfSpread: number;
  gfsSpread: number;
  ecmwfMembers: number;
  gfsMembers: number;
  marketBiasStd: number;
  marketSigma: number;
  createBuckets: (climateValues: number[]) => Bucket[];
  resolvesBucket: (actual: number, bucket: Bucket) => boolean;
  dataSource: "open-meteo" | "usgs";
}

// ═══════════════════════════════════════════════════════════
// Math utilities
// ═══════════════════════════════════════════════════════════

function cToF(c: number): number { return c * 9 / 5 + 32; }
function fToC(f: number): number { return (f - 32) * 5 / 9; }
function kmhToMph(k: number): number { return k * 0.621371; }
function mphToKmh(m: number): number { return m / 0.621371; }
function cmToIn(cm: number): number { return cm / 2.54; }

function gaussianRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function poissonSample(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// ═══════════════════════════════════════════════════════════
// Bucket creation per metric
// ═══════════════════════════════════════════════════════════

const BUCKET_WIDTH_F = 2;
const BUCKET_WIDTH_MPH = 5;

function createTemperatureBuckets(climateValues: number[]): Bucket[] {
  const tempsF = climateValues.map(cToF);
  const p5 = percentile(tempsF, 5);
  const p95 = percentile(tempsF, 95);
  const minF = Math.floor(p5 / BUCKET_WIDTH_F) * BUCKET_WIDTH_F;
  const maxF = Math.ceil(p95 / BUCKET_WIDTH_F) * BUCKET_WIDTH_F;

  const buckets: Bucket[] = [];
  buckets.push({
    label: `≤${minF}°F`, rule_type: "above_below",
    threshold_low: null, threshold_high: fToC(minF),
  });
  for (let f = minF + 1; f < maxF; f += BUCKET_WIDTH_F) {
    const hiF = f + BUCKET_WIDTH_F - 1;
    buckets.push({
      label: `${f}-${hiF}°F`, rule_type: "range",
      threshold_low: fToC(f), threshold_high: fToC(hiF),
    });
  }
  buckets.push({
    label: `≥${maxF}°F`, rule_type: "above_below",
    threshold_low: fToC(maxF), threshold_high: null,
  });
  return buckets;
}

function resolveTemperatureBucket(actualC: number, bucket: Bucket): boolean {
  const actualF = cToF(actualC);
  if (bucket.rule_type === "above_below") {
    if (bucket.threshold_low != null && bucket.threshold_high == null) return actualF >= cToF(bucket.threshold_low);
    if (bucket.threshold_high != null && bucket.threshold_low == null) return actualF <= cToF(bucket.threshold_high);
    return false;
  }
  return actualF >= cToF(bucket.threshold_low!) && actualF <= cToF(bucket.threshold_high!);
}

function createSnowfallBuckets(_climateValues: number[]): Bucket[] {
  // Fixed thresholds in cm (Polymarket uses inches, we store cm)
  return [
    { label: "0 in", rule_type: "above_below", threshold_low: null, threshold_high: 0.05 },
    { label: "0.1–1 in", rule_type: "range", threshold_low: 0.1 * 2.54, threshold_high: 1 * 2.54 },
    { label: "1–3 in", rule_type: "range", threshold_low: 1 * 2.54, threshold_high: 3 * 2.54 },
    { label: "3–6 in", rule_type: "range", threshold_low: 3 * 2.54, threshold_high: 6 * 2.54 },
    { label: "6–12 in", rule_type: "range", threshold_low: 6 * 2.54, threshold_high: 12 * 2.54 },
    { label: "≥12 in", rule_type: "above_below", threshold_low: 12 * 2.54, threshold_high: null },
  ];
}

function resolveSnowfallBucket(actualCm: number, bucket: Bucket): boolean {
  if (bucket.rule_type === "above_below") {
    if (bucket.threshold_low != null && bucket.threshold_high == null) return actualCm >= bucket.threshold_low;
    if (bucket.threshold_high != null && bucket.threshold_low == null) return actualCm <= bucket.threshold_high;
    return false;
  }
  return actualCm >= bucket.threshold_low! && actualCm < bucket.threshold_high!;
}

function createRainfallBuckets(_climateValues: number[]): Bucket[] {
  // Fixed thresholds in mm
  return [
    { label: "0 mm", rule_type: "above_below", threshold_low: null, threshold_high: 0.1 },
    { label: "0.1–2 mm", rule_type: "range", threshold_low: 0.1, threshold_high: 2 },
    { label: "2–10 mm", rule_type: "range", threshold_low: 2, threshold_high: 10 },
    { label: "10–25 mm", rule_type: "range", threshold_low: 10, threshold_high: 25 },
    { label: "25–50 mm", rule_type: "range", threshold_low: 25, threshold_high: 50 },
    { label: "≥50 mm", rule_type: "above_below", threshold_low: 50, threshold_high: null },
  ];
}

function resolveRainfallBucket(actualMm: number, bucket: Bucket): boolean {
  return resolveSnowfallBucket(actualMm, bucket); // same logic
}

function createWindSpeedBuckets(climateValues: number[]): Bucket[] {
  const mph = climateValues.map(kmhToMph);
  const p5 = percentile(mph, 5);
  const p95 = percentile(mph, 95);
  const minMph = Math.floor(p5 / BUCKET_WIDTH_MPH) * BUCKET_WIDTH_MPH;
  const maxMph = Math.ceil(p95 / BUCKET_WIDTH_MPH) * BUCKET_WIDTH_MPH;

  const buckets: Bucket[] = [];
  buckets.push({
    label: `≤${minMph} mph`, rule_type: "above_below",
    threshold_low: null, threshold_high: mphToKmh(minMph),
  });
  for (let m = minMph + 1; m < maxMph; m += BUCKET_WIDTH_MPH) {
    const hiM = m + BUCKET_WIDTH_MPH - 1;
    buckets.push({
      label: `${m}-${hiM} mph`, rule_type: "range",
      threshold_low: mphToKmh(m), threshold_high: mphToKmh(hiM),
    });
  }
  buckets.push({
    label: `≥${maxMph} mph`, rule_type: "above_below",
    threshold_low: mphToKmh(maxMph), threshold_high: null,
  });
  return buckets;
}

function resolveWindSpeedBucket(actualKmh: number, bucket: Bucket): boolean {
  const actualMph = kmhToMph(actualKmh);
  if (bucket.rule_type === "above_below") {
    if (bucket.threshold_low != null && bucket.threshold_high == null) return actualMph >= kmhToMph(bucket.threshold_low);
    if (bucket.threshold_high != null && bucket.threshold_low == null) return actualMph <= kmhToMph(bucket.threshold_high);
    return false;
  }
  return actualMph >= kmhToMph(bucket.threshold_low!) && actualMph <= kmhToMph(bucket.threshold_high!);
}

function createEarthquakeBuckets(_climateValues: number[]): Bucket[] {
  // Binary markets: "Will there be a magnitude ≥ X earthquake?"
  return [
    { label: "≥3.0 M", rule_type: "above_below", threshold_low: 3.0, threshold_high: null },
    { label: "≥4.0 M", rule_type: "above_below", threshold_low: 4.0, threshold_high: null },
    { label: "≥5.0 M", rule_type: "above_below", threshold_low: 5.0, threshold_high: null },
    { label: "≥6.0 M", rule_type: "above_below", threshold_low: 6.0, threshold_high: null },
  ];
}

function resolveEarthquakeBucket(actualMag: number, bucket: Bucket): boolean {
  if (bucket.threshold_low != null) return actualMag >= bucket.threshold_low;
  if (bucket.threshold_high != null) return actualMag <= bucket.threshold_high;
  return false;
}

// ═══════════════════════════════════════════════════════════
// Metric profiles
// ═══════════════════════════════════════════════════════════

const METRIC_PROFILES: Record<WeatherMetric, MetricProfile> = {
  temperature: {
    metric: "temperature",
    label: "Temperature",
    locations: [
      { name: "New York", lat: 40.71, lon: -74.01 },
      { name: "Chicago", lat: 41.88, lon: -87.63 },
      { name: "Miami", lat: 25.76, lon: -80.19 },
      { name: "Denver", lat: 39.74, lon: -104.99 },
      { name: "Los Angeles", lat: 34.05, lon: -118.24 },
    ],
    archiveVar: "temperature_2m_max",
    primaryUnit: "°C",
    forecastBiasStd: 0.8,
    ecmwfSpread: 1.0,
    gfsSpread: 1.3,
    ecmwfMembers: 51,
    gfsMembers: 31,
    marketBiasStd: 1.8,
    marketSigma: 2.5,
    createBuckets: createTemperatureBuckets,
    resolvesBucket: resolveTemperatureBucket,
    dataSource: "open-meteo",
  },
  snowfall: {
    metric: "snowfall",
    label: "Snowfall",
    locations: [
      { name: "Denver", lat: 39.74, lon: -104.99 },
      { name: "Chicago", lat: 41.88, lon: -87.63 },
      { name: "New York", lat: 40.71, lon: -74.01 },
      { name: "Minneapolis", lat: 44.98, lon: -93.27 },
      { name: "Boston", lat: 42.36, lon: -71.06 },
    ],
    archiveVar: "snowfall_sum",
    primaryUnit: "cm",
    forecastBiasStd: 1.5,
    ecmwfSpread: 2.0,
    gfsSpread: 2.5,
    ecmwfMembers: 51,
    gfsMembers: 31,
    marketBiasStd: 3.0,
    marketSigma: 4.0,
    createBuckets: createSnowfallBuckets,
    resolvesBucket: resolveSnowfallBucket,
    dataSource: "open-meteo",
  },
  rainfall: {
    metric: "rainfall",
    label: "Rainfall",
    locations: [
      { name: "Seattle", lat: 47.61, lon: -122.33 },
      { name: "Miami", lat: 25.76, lon: -80.19 },
      { name: "Houston", lat: 29.76, lon: -95.37 },
      { name: "New York", lat: 40.71, lon: -74.01 },
      { name: "Portland", lat: 45.52, lon: -122.68 },
    ],
    archiveVar: "precipitation_sum",
    primaryUnit: "mm",
    forecastBiasStd: 3.0,
    ecmwfSpread: 4.0,
    gfsSpread: 5.0,
    ecmwfMembers: 51,
    gfsMembers: 31,
    marketBiasStd: 6.0,
    marketSigma: 8.0,
    createBuckets: createRainfallBuckets,
    resolvesBucket: resolveRainfallBucket,
    dataSource: "open-meteo",
  },
  wind_speed: {
    metric: "wind_speed",
    label: "Wind Speed",
    locations: [
      { name: "Miami", lat: 25.76, lon: -80.19 },
      { name: "Chicago", lat: 41.88, lon: -87.63 },
      { name: "Oklahoma City", lat: 35.47, lon: -97.52 },
      { name: "New York", lat: 40.71, lon: -74.01 },
      { name: "Denver", lat: 39.74, lon: -104.99 },
    ],
    archiveVar: "wind_gusts_10m_max",
    primaryUnit: "km/h",
    forecastBiasStd: 5.0,
    ecmwfSpread: 7.0,
    gfsSpread: 9.0,
    ecmwfMembers: 51,
    gfsMembers: 31,
    marketBiasStd: 12.0,
    marketSigma: 15.0,
    createBuckets: createWindSpeedBuckets,
    resolvesBucket: resolveWindSpeedBucket,
    dataSource: "open-meteo",
  },
  earthquake_magnitude: {
    metric: "earthquake_magnitude",
    label: "Earthquake",
    locations: [
      { name: "Los Angeles", lat: 34.05, lon: -118.24 },
      { name: "San Francisco", lat: 37.77, lon: -122.42 },
      { name: "Anchorage", lat: 61.22, lon: -149.90 },
      { name: "Seattle", lat: 47.61, lon: -122.33 },
      { name: "Salt Lake City", lat: 40.76, lon: -111.89 },
    ],
    archiveVar: "", // uses USGS
    primaryUnit: "M",
    forecastBiasStd: 0, // N/A
    ecmwfSpread: 0,
    gfsSpread: 0,
    ecmwfMembers: 0,
    gfsMembers: 0,
    marketBiasStd: 0,
    marketSigma: 0,
    createBuckets: createEarthquakeBuckets,
    resolvesBucket: resolveEarthquakeBucket,
    dataSource: "usgs",
  },
  climate_anomaly: {
    metric: "climate_anomaly",
    label: "Climate Anomaly",
    locations: [
      // NASA GISS is a global index — use a single placeholder location
      { name: "Global", lat: 0, lon: 0 },
    ],
    archiveVar: "", // uses NASA GISS
    primaryUnit: "°C",
    forecastBiasStd: 0.1,
    ecmwfSpread: 0.15,
    gfsSpread: 0.15,
    ecmwfMembers: 51,
    gfsMembers: 31,
    marketBiasStd: 0.2,
    marketSigma: 0.3,
    createBuckets: (_values: number[]) => [],  // placeholder — not yet backtestable
    resolvesBucket: (_actual: number, _bucket: Bucket) => false,
    dataSource: "open-meteo", // placeholder
  },
};

// ═══════════════════════════════════════════════════════════
// Data fetching (with retry + backoff for rate limits)
// ═══════════════════════════════════════════════════════════

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1500;
const USGS_API = "https://earthquake.usgs.gov/fdsnws/event/1/query";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDailyValues(
  lat: number, lon: number, start: string, end: string, dailyVar: string
): Promise<{ dates: string[]; values: number[] }> {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=${dailyVar}&timezone=auto`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return { dates: data.daily.time, values: data.daily[dailyVar] };
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(delay);
      continue;
    }
    throw new Error(`Archive API error: ${res.status} for ${dailyVar}`);
  }
  throw new Error("Archive API: max retries exceeded");
}

interface EarthquakeEvent {
  magnitude: number;
  time: number; // unix ms
}

async function fetchUSGSEarthquakes(
  lat: number, lon: number, radiusKm: number = 250, lookbackYears: number = 20
): Promise<EarthquakeEvent[]> {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - lookbackYears);

  const url = new URL(USGS_API);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("maxradiuskm", radiusKm.toString());
  url.searchParams.set("starttime", start.toISOString().split("T")[0]);
  url.searchParams.set("endtime", end.toISOString().split("T")[0]);
  url.searchParams.set("minmagnitude", "2.0");
  url.searchParams.set("orderby", "time-asc");
  url.searchParams.set("limit", "20000");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`USGS API error: ${res.status}`);

  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.features || []).map((f: any) => ({
    magnitude: f.properties.mag as number,
    time: f.properties.time as number,
  }));
}

/**
 * Convert USGS events into daily max magnitude time series.
 * For each day in the range, returns the max magnitude of any earthquake
 * within a 7-day window centered on that day.
 */
function computeDailyMaxMagnitude(
  events: EarthquakeEvent[], startDate: string, endDate: string, windowDays: number = 7
): { dates: string[]; values: number[] } {
  const dates: string[] = [];
  const values: number[] = [];
  const halfWindow = Math.floor(windowDays / 2);

  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const dayMs = d.getTime();
    const windowStart = dayMs - halfWindow * 86400000;
    const windowEnd = dayMs + halfWindow * 86400000;

    let maxMag = 0;
    for (const e of events) {
      if (e.time >= windowStart && e.time <= windowEnd && e.magnitude > maxMag) {
        maxMag = e.magnitude;
      }
    }

    dates.push(dateStr);
    values.push(maxMag);
  }

  return { dates, values };
}

/**
 * Build Poisson-based synthetic ensemble from earthquake history.
 */
function buildEarthquakeSyntheticEnsemble(
  events: EarthquakeEvent[], lookbackYears: number = 20,
  windowDays: number = 7, syntheticMembers: number = 1000
): number[] {
  const magnitudes = events.map((e) => e.magnitude).filter((m) => m > 0);

  if (magnitudes.length < 5) {
    return Array.from({ length: syntheticMembers }, () =>
      Math.random() < 0.005 ? 2.0 + Math.random() * 4.0 : 0
    );
  }

  const totalDays = lookbackYears * 365.25;
  const dailyRate = magnitudes.length / totalDays;
  const windowRate = dailyRate * windowDays;

  const members: number[] = [];
  for (let i = 0; i < syntheticMembers; i++) {
    const nEvents = poissonSample(windowRate);
    if (nEvents === 0) {
      members.push(0);
    } else {
      const sampled = Array.from(
        { length: nEvents },
        () => magnitudes[Math.floor(Math.random() * magnitudes.length)]
      );
      members.push(Math.max(...sampled));
    }
  }
  return members;
}

// ═══════════════════════════════════════════════════════════
// Market price simulation (generalized)
// ═══════════════════════════════════════════════════════════

function climatologicalPrices(
  buckets: Bucket[], climateValues: number[],
  profile: MetricProfile
): number[] {
  const n = climateValues.length;
  const numBuckets = buckets.length;
  const counts = buckets.map((b) => {
    let hits = 0;
    for (const v of climateValues) { if (profile.resolvesBucket(v, b)) hits++; }
    return hits;
  });
  const smoothed = counts.map((c) => (c + 0.5) / (n + 0.5 * numBuckets));
  const total = smoothed.reduce((s, v) => s + v, 0);
  return smoothed.map((p) => Math.max(0.02, Math.min(0.98, p / total)));
}

function noisyForecastPrices(
  buckets: Bucket[], actualValue: number,
  profile: MetricProfile
): number[] {
  const marketForecast = actualValue + gaussianRandom() * profile.marketBiasStd;
  const probs = buckets.map((b) => {
    if (b.rule_type === "above_below") {
      if (b.threshold_low != null && b.threshold_high == null)
        return 1 - normalCDF((b.threshold_low - marketForecast) / profile.marketSigma);
      if (b.threshold_high != null && b.threshold_low == null)
        return normalCDF((b.threshold_high - marketForecast) / profile.marketSigma);
      return 0.05;
    }
    return normalCDF((b.threshold_high! - marketForecast) / profile.marketSigma) -
      normalCDF((b.threshold_low! - marketForecast) / profile.marketSigma);
  });
  const total = probs.reduce((s, v) => s + v, 0);
  return probs.map((p) => Math.max(0.02, Math.min(0.98, total > 0 ? p / total : 1 / buckets.length)));
}

// ═══════════════════════════════════════════════════════════
// Ensemble simulation (generalized)
// ═══════════════════════════════════════════════════════════

function simulateWeatherEnsemble(actualValue: number, profile: MetricProfile): number[] {
  const forecastMean = actualValue + gaussianRandom() * profile.forecastBiasStd;
  const ecmwf = Array.from({ length: profile.ecmwfMembers }, () =>
    forecastMean + gaussianRandom() * profile.ecmwfSpread
  );
  const gfs = Array.from({ length: profile.gfsMembers }, () =>
    forecastMean + gaussianRandom() * profile.gfsSpread
  );
  return [...ecmwf, ...gfs];
}

function ensembleProbability(members: number[], bucket: Bucket, profile: MetricProfile): number {
  const n = members.length;
  if (n === 0) return 0.5;
  let hits = 0;
  for (const v of members) { if (profile.resolvesBucket(v, bucket)) hits++; }
  return (hits + 1) / (n + 2);
}

// ═══════════════════════════════════════════════════════════
// Kelly & trade logic
// ═══════════════════════════════════════════════════════════

function kellyFraction(
  modelProb: number, marketPrice: number, side: "BUY_YES" | "BUY_NO", feeFrac: number
): number {
  let kelly: number;
  if (side === "BUY_YES") {
    const ep = marketPrice + feeFrac;
    if (ep >= 1) return 0;
    kelly = (modelProb - ep) / (1 - ep);
  } else {
    const ep = (1 - marketPrice) + feeFrac;
    if (ep >= 1) return 0;
    kelly = ((1 - modelProb) - ep) / (1 - ep);
  }
  return Math.max(0, Math.min(0.25, kelly));
}

function computePnl(
  side: "BUY_YES" | "BUY_NO", resolvedYes: boolean, yesPrice: number,
  size: number, feeBps: number, slippageBps: number
): number {
  if (size === 0) return 0;
  const totalCostRate = (feeBps + slippageBps) / 10000;
  let grossPnl: number;
  if (side === "BUY_YES") {
    grossPnl = resolvedYes ? (1 - yesPrice) * size : -yesPrice * size;
  } else {
    const noPrice = 1 - yesPrice;
    grossPnl = !resolvedYes ? (1 - noPrice) * size : -noPrice * size;
  }
  return Math.round((grossPnl - totalCostRate * size) * 100) / 100;
}

function findTrades(
  buckets: Bucket[], modelProbs: number[], marketPrices: number[],
  feeBps: number, slippageBps: number, baseSizeUsd: number, confidence: number
): Trade[] {
  const feeFrac = (feeBps + slippageBps) / 10000;
  const candidates: (Trade & { absEdge: number })[] = [];

  for (let i = 0; i < buckets.length; i++) {
    const mp = Math.max(0.01, Math.min(0.99, modelProbs[i]));
    const mktP = marketPrices[i];
    const edge = mp - mktP - feeFrac;

    let side: "BUY_YES" | "BUY_NO" | null = null;
    let tradeEdge = 0;
    if (edge > MIN_EDGE) { side = "BUY_YES"; tradeEdge = edge; }
    else if (edge < -MIN_EDGE) { side = "BUY_NO"; tradeEdge = -edge; }

    if (side) {
      const kelly = kellyFraction(mp, mktP, side, feeFrac);
      const size = Math.round(baseSizeUsd * kelly * 0.5 * (confidence / 100) * 100) / 100;
      if (size >= 1) {
        candidates.push({
          date: "", city: "", bucket_label: buckets[i].label,
          side, model_prob: mp, market_price: mktP,
          edge: side === "BUY_YES" ? edge : -edge,
          kelly, size_usd: size, absEdge: tradeEdge,
        });
      }
    }
  }
  candidates.sort((a, b) => b.absEdge - a.absEdge);
  return candidates.slice(0, MAX_TRADES_PER_EVENT);
}

// ═══════════════════════════════════════════════════════════
// Aggregate computation functions
// ═══════════════════════════════════════════════════════════

function computeMetrics(results: StrategyTradeResult[]): ScenarioMetrics {
  const totalPnl = results.reduce((s, r) => s + r.pnl, 0);
  const totalInvested = results.reduce((s, r) => s + r.size_usd, 0);
  const wins = results.filter((r) => r.won).length;
  const losses = results.filter((r) => !r.won && r.pnl < 0).length;

  const dailyPnlMap = new Map<string, number>();
  for (const r of results) dailyPnlMap.set(r.date, (dailyPnlMap.get(r.date) || 0) + r.pnl);
  const dailyReturns = Array.from(dailyPnlMap.values());
  const meanD = dailyReturns.reduce((s, v) => s + v, 0) / Math.max(1, dailyReturns.length);
  const stdD = Math.sqrt(dailyReturns.reduce((s, v) => s + (v - meanD) ** 2, 0) / Math.max(1, dailyReturns.length - 1));
  const sharpe = stdD > 0 ? (meanD / stdD) * Math.sqrt(252) : 0;

  let peak = 0, cumPnl = 0, maxDD = 0;
  const sorted = Array.from(dailyPnlMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, pnl] of sorted) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  const grossProfit = results.filter((r) => r.pnl > 0).reduce((s, r) => s + r.pnl, 0);
  const grossLoss = Math.abs(results.filter((r) => r.pnl < 0).reduce((s, r) => s + r.pnl, 0));

  let maxStreak = 0, streak = 0;
  const sortedResults = [...results].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of sortedResults) {
    if (r.pnl < 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
  }

  const best = results.reduce((a, b) => a.pnl > b.pnl ? a : b);
  const worst = results.reduce((a, b) => a.pnl < b.pnl ? a : b);

  return {
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalInvested: Math.round(totalInvested * 100) / 100,
    roi: totalInvested > 0 ? Math.round((totalPnl / totalInvested) * 1000) / 10 : 0,
    winRate: results.length > 0 ? Math.round((wins / results.length) * 1000) / 10 : 0,
    wins, losses, totalTrades: results.length,
    avgEdge: Math.round((results.reduce((s, r) => s + Math.abs(r.edge), 0) / Math.max(1, results.length)) * 1000) / 10,
    avgPnlPerTrade: Math.round((totalPnl / Math.max(1, results.length)) * 100) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : 999,
    longestLosingStreak: maxStreak,
    bestTrade: { pnl: best.pnl, city: best.city, date: best.date, side: best.side, bucket: best.bucket_label },
    worstTrade: { pnl: worst.pnl, city: worst.city, date: worst.date, side: worst.side, bucket: worst.bucket_label },
  };
}

function computeDailyPnl(results: StrategyTradeResult[]): DailyPnl[] {
  const map = new Map<string, number>();
  for (const r of results) map.set(r.date, (map.get(r.date) || 0) + r.pnl);
  const days = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let cum = 0;
  return days.map(([date, pnl]) => {
    cum += pnl;
    return { date, pnl: Math.round(pnl * 100) / 100, cumulative: Math.round(cum * 100) / 100 };
  });
}

function computeMonthlyPnl(results: StrategyTradeResult[]): MonthlyPnl[] {
  const map = new Map<string, StrategyTradeResult[]>();
  for (const r of results) {
    const m = r.date.substring(0, 7);
    if (!map.has(m)) map.set(m, []);
    map.get(m)!.push(r);
  }
  const months = Array.from(map.keys()).sort();
  let cum = 0;
  return months.map((month) => {
    const mr = map.get(month)!;
    const pnl = mr.reduce((s, r) => s + r.pnl, 0);
    cum += pnl;
    const wr = mr.length > 0 ? mr.filter((r) => r.won).length / mr.length : 0;
    return {
      month, pnl: Math.round(pnl * 100) / 100,
      cumulative: Math.round(cum * 100) / 100,
      winRate: Math.round(wr * 1000) / 10, trades: mr.length,
    };
  });
}

function computeCityBreakdown(results: StrategyTradeResult[]): CityBreakdown[] {
  const map = new Map<string, StrategyTradeResult[]>();
  for (const r of results) {
    if (!map.has(r.city)) map.set(r.city, []);
    map.get(r.city)!.push(r);
  }
  return Array.from(map.entries()).map(([city, trades]) => ({
    city,
    pnl: Math.round(trades.reduce((s, r) => s + r.pnl, 0) * 100) / 100,
    winRate: Math.round((trades.filter((r) => r.won).length / Math.max(1, trades.length)) * 1000) / 10,
    trades: trades.length,
  })).sort((a, b) => b.pnl - a.pnl);
}

function computeTradeTypeBreakdown(results: StrategyTradeResult[]): TradeTypeBreakdown[] {
  return (["BUY_YES", "BUY_NO"] as const).map((side) => {
    const trades = results.filter((r) => r.side === side);
    return {
      side,
      pnl: Math.round(trades.reduce((s, r) => s + r.pnl, 0) * 100) / 100,
      winRate: trades.length > 0 ? Math.round((trades.filter((r) => r.won).length / trades.length) * 1000) / 10 : 0,
      trades: trades.length,
      avgEdge: trades.length > 0 ? Math.round((trades.reduce((s, r) => s + Math.abs(r.edge), 0) / trades.length) * 1000) / 10 : 0,
    };
  });
}

function computeCalibration(results: StrategyTradeResult[]): CalibrationBucket[] {
  const bins = [
    { label: "0-10%", min: 0, max: 0.1 }, { label: "10-20%", min: 0.1, max: 0.2 },
    { label: "20-30%", min: 0.2, max: 0.3 }, { label: "30-40%", min: 0.3, max: 0.4 },
    { label: "40-50%", min: 0.4, max: 0.5 }, { label: "50-60%", min: 0.5, max: 0.6 },
    { label: "60-70%", min: 0.6, max: 0.7 }, { label: "70-80%", min: 0.7, max: 0.8 },
    { label: "80-90%", min: 0.8, max: 0.9 }, { label: "90-100%", min: 0.9, max: 1.0 },
  ];
  return bins.map((b) => {
    const matching = results.filter((r) => r.model_prob >= b.min && r.model_prob < b.max);
    const actual = matching.length > 0 ? matching.filter((r) => r.resolved_yes).length / matching.length : 0;
    return { label: b.label, predicted: Math.round((b.min + b.max) / 2 * 100), actual: Math.round(actual * 100), count: matching.length };
  }).filter((b) => b.count >= 5);
}

function computeEdgeHistogram(results: StrategyTradeResult[]): EdgeHistogramBucket[] {
  const bins = [
    { label: "3-5%", min: 0.03, max: 0.05 }, { label: "5-8%", min: 0.05, max: 0.08 },
    { label: "8-12%", min: 0.08, max: 0.12 }, { label: "12-20%", min: 0.12, max: 0.20 },
    { label: "20-30%", min: 0.20, max: 0.30 }, { label: "30%+", min: 0.30, max: 1.0 },
  ];
  return bins.map((b) => ({
    label: b.label,
    count: results.filter((r) => { const ae = Math.abs(r.edge); return ae >= b.min && ae < b.max; }).length,
  }));
}

// ═══════════════════════════════════════════════════════════
// Main backtest runner
// ═══════════════════════════════════════════════════════════

export async function runStrategyBacktest(userConfig?: BacktestConfig): Promise<BacktestOutput> {
  const metric = userConfig?.metric ?? "temperature";
  const profile = METRIC_PROFILES[metric];
  const startDate = userConfig?.start ?? DEFAULT_START;
  const endDate = userConfig?.end ?? DEFAULT_END;
  const feeBps = userConfig?.feeBps ?? DEFAULT_FEE_BPS;
  const slippageBps = userConfig?.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const baseSizeUsd = userConfig?.baseSizeUsd ?? BASE_SIZE_USD;
  const confidence = userConfig?.confidence ?? USER_CONFIDENCE;

  const locations = profile.locations;

  // 1. Fetch location data
  const locationData = new Map<string, {
    actuals: { dates: string[]; values: number[] };
    climate: { dates: string[]; values: number[] };
    earthquakeEvents?: EarthquakeEvent[];
  }>();

  if (profile.dataSource === "usgs") {
    // Earthquake: fetch USGS events per location
    for (let li = 0; li < locations.length; li++) {
      const loc = locations[li];
      const events = await fetchUSGSEarthquakes(loc.lat, loc.lon);
      const actuals = computeDailyMaxMagnitude(events, startDate, endDate);
      // For earthquake, climate = full historical data for base rate pricing
      const climateEvents = events; // use all events for climatology
      const climate = computeDailyMaxMagnitude(climateEvents, CLIMATE_START, CLIMATE_END);
      locationData.set(loc.name, { actuals, climate, earthquakeEvents: events });
      if (li < locations.length - 1) await sleep(1000); // USGS rate limit
    }
  } else {
    // Weather: fetch Open-Meteo archive
    for (let li = 0; li < locations.length; li++) {
      const loc = locations[li];
      const [actuals, climate] = await Promise.all([
        fetchDailyValues(loc.lat, loc.lon, startDate, endDate, profile.archiveVar),
        fetchDailyValues(loc.lat, loc.lon, CLIMATE_START, CLIMATE_END, profile.archiveVar),
      ]);
      locationData.set(loc.name, { actuals, climate });
      if (li < locations.length - 1) await sleep(500);
    }
  }

  // 2. Run both scenarios
  const scenarioDefs = [
    { name: "Climatological Market", description: "Market priced by historical base rates (naive traders)" },
    { name: "Noisy Forecast Market", description: "Market priced by less accurate forecasts (decent traders)" },
  ];

  // Earthquake only uses climatological pricing (no "noisy forecast" for earthquakes)
  const activeScenarios = profile.dataSource === "usgs"
    ? [scenarioDefs[0]]
    : scenarioDefs;

  const scenarios: ScenarioResult[] = [];

  for (const scenarioDef of activeScenarios) {
    const results: StrategyTradeResult[] = [];

    for (const loc of locations) {
      const data = locationData.get(loc.name)!;
      const { actuals, climate } = data;

      if (profile.dataSource === "usgs") {
        // Earthquake: use Poisson ensemble for each day
        const ensemble = buildEarthquakeSyntheticEnsemble(data.earthquakeEvents!);

        for (let i = 0; i < actuals.dates.length; i++) {
          const actualValue = actuals.values[i];
          if (actualValue == null) continue;
          const date = actuals.dates[i];

          const buckets = profile.createBuckets(climate.values);
          const marketPrices = climatologicalPrices(buckets, climate.values, profile);
          const modelProbs = buckets.map((b) => ensembleProbability(ensemble, b, profile));
          const trades = findTrades(buckets, modelProbs, marketPrices, feeBps, slippageBps, baseSizeUsd, confidence);

          for (const trade of trades) {
            const bucket = buckets.find((b) => b.label === trade.bucket_label)!;
            const resolvedYes = profile.resolvesBucket(actualValue, bucket);
            const pnl = computePnl(trade.side, resolvedYes, trade.market_price, trade.size_usd, feeBps, slippageBps);
            results.push({ ...trade, date, city: loc.name, resolved_yes: resolvedYes, pnl, won: pnl > 0 });
          }
        }
      } else {
        // Weather metrics: group climate by month for seasonal buckets
        const climateByMonth = new Map<number, number[]>();
        for (let i = 0; i < climate.dates.length; i++) {
          if (climate.values[i] == null) continue;
          const month = new Date(climate.dates[i]).getMonth();
          if (!climateByMonth.has(month)) climateByMonth.set(month, []);
          climateByMonth.get(month)!.push(climate.values[i]);
        }

        for (let i = 0; i < actuals.dates.length; i++) {
          const actualValue = actuals.values[i];
          if (actualValue == null) continue;
          const date = actuals.dates[i];
          const month = new Date(date).getMonth();

          // For snow/rain with fixed buckets, use all climate data
          // For temperature/wind with percentile buckets, use monthly data
          let climateForBuckets: number[];
          if (metric === "snowfall" || metric === "rainfall") {
            climateForBuckets = climate.values.filter((v) => v != null);
          } else {
            const monthClimate = climateByMonth.get(month);
            if (!monthClimate || monthClimate.length < 30) continue;
            climateForBuckets = monthClimate;
          }

          const buckets = profile.createBuckets(climateForBuckets);
          if (buckets.length < 3) continue;

          const marketPrices = scenarioDef.name === "Climatological Market"
            ? climatologicalPrices(buckets, climateForBuckets, profile)
            : noisyForecastPrices(buckets, actualValue, profile);

          const ensemble = simulateWeatherEnsemble(actualValue, profile);
          const modelProbs = buckets.map((b) => ensembleProbability(ensemble, b, profile));
          const trades = findTrades(buckets, modelProbs, marketPrices, feeBps, slippageBps, baseSizeUsd, confidence);

          for (const trade of trades) {
            const bucket = buckets.find((b) => b.label === trade.bucket_label)!;
            const resolvedYes = profile.resolvesBucket(actualValue, bucket);
            const pnl = computePnl(trade.side, resolvedYes, trade.market_price, trade.size_usd, feeBps, slippageBps);
            results.push({ ...trade, date, city: loc.name, resolved_yes: resolvedYes, pnl, won: pnl > 0 });
          }
        }
      }
    }

    if (results.length > 0) {
      scenarios.push({
        name: scenarioDef.name,
        description: scenarioDef.description,
        metrics: computeMetrics(results),
        dailyPnl: computeDailyPnl(results),
        monthlyPnl: computeMonthlyPnl(results),
        cityBreakdown: computeCityBreakdown(results),
        tradeTypeBreakdown: computeTradeTypeBreakdown(results),
        calibration: computeCalibration(results),
        edgeHistogram: computeEdgeHistogram(results),
      });
    }
  }

  return {
    config: {
      start: startDate,
      end: endDate,
      cities: locations.map((l) => l.name),
      baseSize: baseSizeUsd,
      feeBps,
      slippageBps,
      minEdge: MIN_EDGE,
      confidence,
      metric,
      unit: profile.primaryUnit,
    },
    computedAt: new Date().toISOString(),
    scenarios,
  };
}

/** Export profiles for use by CLI script */
export { METRIC_PROFILES, USGS_API };
export type { MetricProfile };
