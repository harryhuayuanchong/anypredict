/**
 * Strategy Backtest Engine
 *
 * Ports the CLI script (scripts/backtest.ts) into a library module
 * that returns structured JSON for the API route and frontend.
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

// ═══════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════

const CITIES = [
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "Chicago", lat: 41.88, lon: -87.63 },
  { name: "Miami", lat: 25.76, lon: -80.19 },
  { name: "Denver", lat: 39.74, lon: -104.99 },
  { name: "Los Angeles", lat: 34.05, lon: -118.24 },
];

// Defaults (used when no user config is provided)
const DEFAULT_START = "2025-08-15";
const DEFAULT_END = "2026-02-15";
const CLIMATE_START = "2019-01-01";
const CLIMATE_END = "2024-12-31";

const DEFAULT_FEE_BPS = 100;
const DEFAULT_SLIPPAGE_BPS = 50;
const BASE_SIZE_USD = 100;
const MIN_EDGE = 0.03;
const USER_CONFIDENCE = 70;
const BUCKET_WIDTH_F = 2;

/** User-configurable parameters passed from the frontend */
export interface BacktestConfig {
  start?: string;       // default "2025-08-15"
  end?: string;         // default "2026-02-15"
  feeBps?: number;      // default 100 (1%)
  slippageBps?: number; // default 50  (0.5%)
  baseSizeUsd?: number; // default 100
  confidence?: number;  // default 70 (0-100)
}

const OUR_FORECAST_BIAS_STD = 0.8;
const ECMWF_MEMBER_SPREAD = 1.0;
const GFS_MEMBER_SPREAD = 1.3;
const ECMWF_MEMBERS = 51;
const GFS_MEMBERS = 31;

const MARKET_FORECAST_BIAS_STD = 1.8;
const MARKET_UNCERTAINTY_SIGMA = 2.5;
const MAX_TRADES_PER_EVENT = 3;

// ═══════════════════════════════════════════════════════════
// Types (internal)
// ═══════════════════════════════════════════════════════════

interface Bucket {
  label: string;
  rule_type: "above_below" | "range";
  threshold_low_c: number | null;
  threshold_high_c: number | null;
  low_f: number | null;
  high_f: number | null;
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

// ═══════════════════════════════════════════════════════════
// Math utilities
// ═══════════════════════════════════════════════════════════

function cToF(c: number): number { return c * 9 / 5 + 32; }
function fToC(f: number): number { return (f - 32) * 5 / 9; }

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

// ═══════════════════════════════════════════════════════════
// Data fetching (with retry + backoff for rate limits)
// ═══════════════════════════════════════════════════════════

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDailyMax(
  lat: number, lon: number, start: string, end: string
): Promise<{ dates: string[]; temps: number[] }> {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_max&timezone=auto`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return { dates: data.daily.time, temps: data.daily.temperature_2m_max };
    }
    if (res.status === 429 && attempt < MAX_RETRIES) {
      // Exponential backoff: 1.5s, 3s, 6s, 12s, 24s
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.log(`Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await sleep(delay);
      continue;
    }
    throw new Error(`Archive API error: ${res.status}`);
  }
  throw new Error("Archive API: max retries exceeded");
}

// ═══════════════════════════════════════════════════════════
// Bucket creation & resolution
// ═══════════════════════════════════════════════════════════

function createBuckets(climateTempsC: number[]): Bucket[] {
  const tempsF = climateTempsC.map(cToF);
  const p5 = percentile(tempsF, 5);
  const p95 = percentile(tempsF, 95);
  const minF = Math.floor(p5 / BUCKET_WIDTH_F) * BUCKET_WIDTH_F;
  const maxF = Math.ceil(p95 / BUCKET_WIDTH_F) * BUCKET_WIDTH_F;

  const buckets: Bucket[] = [];
  buckets.push({
    label: `≤${minF}°F`, rule_type: "above_below",
    threshold_low_c: null, threshold_high_c: fToC(minF), low_f: null, high_f: minF,
  });
  for (let f = minF + 1; f < maxF; f += BUCKET_WIDTH_F) {
    const hiF = f + BUCKET_WIDTH_F - 1;
    buckets.push({
      label: `${f}-${hiF}°F`, rule_type: "range",
      threshold_low_c: fToC(f), threshold_high_c: fToC(hiF), low_f: f, high_f: hiF,
    });
  }
  buckets.push({
    label: `≥${maxF}°F`, rule_type: "above_below",
    threshold_low_c: fToC(maxF), threshold_high_c: null, low_f: maxF, high_f: null,
  });
  return buckets;
}

function resolvesBucket(actualC: number, bucket: Bucket): boolean {
  const actualF = cToF(actualC);
  if (bucket.rule_type === "above_below") {
    if (bucket.threshold_low_c != null && bucket.threshold_high_c == null) return actualF >= bucket.low_f!;
    if (bucket.threshold_high_c != null && bucket.threshold_low_c == null) return actualF <= bucket.high_f!;
    return false;
  }
  return actualF >= bucket.low_f! && actualF <= bucket.high_f!;
}

// ═══════════════════════════════════════════════════════════
// Market price simulation
// ═══════════════════════════════════════════════════════════

function climatologicalPrices(buckets: Bucket[], climateTempsC: number[]): number[] {
  const n = climateTempsC.length;
  const numBuckets = buckets.length;
  const counts = buckets.map((b) => {
    let hits = 0;
    for (const tc of climateTempsC) { if (resolvesBucket(tc, b)) hits++; }
    return hits;
  });
  const smoothed = counts.map((c) => (c + 0.5) / (n + 0.5 * numBuckets));
  const total = smoothed.reduce((s, v) => s + v, 0);
  return smoothed.map((p) => Math.max(0.02, Math.min(0.98, p / total)));
}

function noisyForecastPrices(buckets: Bucket[], actualC: number): number[] {
  const marketForecast = actualC + gaussianRandom() * MARKET_FORECAST_BIAS_STD;
  const probs = buckets.map((b) => {
    if (b.rule_type === "above_below") {
      if (b.threshold_low_c != null && b.threshold_high_c == null)
        return 1 - normalCDF((b.threshold_low_c - marketForecast) / MARKET_UNCERTAINTY_SIGMA);
      if (b.threshold_high_c != null && b.threshold_low_c == null)
        return normalCDF((b.threshold_high_c - marketForecast) / MARKET_UNCERTAINTY_SIGMA);
      return 0.05;
    }
    return normalCDF((b.threshold_high_c! - marketForecast) / MARKET_UNCERTAINTY_SIGMA) -
      normalCDF((b.threshold_low_c! - marketForecast) / MARKET_UNCERTAINTY_SIGMA);
  });
  const total = probs.reduce((s, v) => s + v, 0);
  return probs.map((p) => Math.max(0.02, Math.min(0.98, total > 0 ? p / total : 1 / buckets.length)));
}

// ═══════════════════════════════════════════════════════════
// Ensemble simulation & probability
// ═══════════════════════════════════════════════════════════

function simulateEnsemble(actualC: number): { pooled: number[] } {
  const forecastMean = actualC + gaussianRandom() * OUR_FORECAST_BIAS_STD;
  const ecmwf = Array.from({ length: ECMWF_MEMBERS }, () => forecastMean + gaussianRandom() * ECMWF_MEMBER_SPREAD);
  const gfs = Array.from({ length: GFS_MEMBERS }, () => forecastMean + gaussianRandom() * GFS_MEMBER_SPREAD);
  return { pooled: [...ecmwf, ...gfs] };
}

function ensembleProbability(members: number[], bucket: Bucket): number {
  const n = members.length;
  if (n === 0) return 0.5;
  let hits = 0;
  for (const temp of members) { if (resolvesBucket(temp, bucket)) hits++; }
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

function findTrades(buckets: Bucket[], modelProbs: number[], marketPrices: number[], feeBps: number, slippageBps: number, baseSizeUsd: number, confidence: number): Trade[] {
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

  // Sharpe
  const dailyPnlMap = new Map<string, number>();
  for (const r of results) dailyPnlMap.set(r.date, (dailyPnlMap.get(r.date) || 0) + r.pnl);
  const dailyReturns = [...dailyPnlMap.values()];
  const meanD = dailyReturns.reduce((s, v) => s + v, 0) / Math.max(1, dailyReturns.length);
  const stdD = Math.sqrt(dailyReturns.reduce((s, v) => s + (v - meanD) ** 2, 0) / Math.max(1, dailyReturns.length - 1));
  const sharpe = stdD > 0 ? (meanD / stdD) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = 0, cumPnl = 0, maxDD = 0;
  const sorted = [...dailyPnlMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, pnl] of sorted) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Profit factor
  const grossProfit = results.filter((r) => r.pnl > 0).reduce((s, r) => s + r.pnl, 0);
  const grossLoss = Math.abs(results.filter((r) => r.pnl < 0).reduce((s, r) => s + r.pnl, 0));

  // Losing streak
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
  const days = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
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
  const months = [...map.keys()].sort();
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
  return [...map.entries()].map(([city, trades]) => ({
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
    { label: "0-10%", min: 0, max: 0.1 },
    { label: "10-20%", min: 0.1, max: 0.2 },
    { label: "20-30%", min: 0.2, max: 0.3 },
    { label: "30-40%", min: 0.3, max: 0.4 },
    { label: "40-50%", min: 0.4, max: 0.5 },
    { label: "50-60%", min: 0.5, max: 0.6 },
    { label: "60-70%", min: 0.6, max: 0.7 },
    { label: "70-80%", min: 0.7, max: 0.8 },
    { label: "80-90%", min: 0.8, max: 0.9 },
    { label: "90-100%", min: 0.9, max: 1.0 },
  ];
  return bins.map((b) => {
    const matching = results.filter((r) => r.model_prob >= b.min && r.model_prob < b.max);
    const actual = matching.length > 0 ? matching.filter((r) => r.resolved_yes).length / matching.length : 0;
    return {
      label: b.label,
      predicted: Math.round((b.min + b.max) / 2 * 100),
      actual: Math.round(actual * 100),
      count: matching.length,
    };
  }).filter((b) => b.count >= 5);
}

function computeEdgeHistogram(results: StrategyTradeResult[]): EdgeHistogramBucket[] {
  const bins = [
    { label: "3-5%", min: 0.03, max: 0.05 },
    { label: "5-8%", min: 0.05, max: 0.08 },
    { label: "8-12%", min: 0.08, max: 0.12 },
    { label: "12-20%", min: 0.12, max: 0.20 },
    { label: "20-30%", min: 0.20, max: 0.30 },
    { label: "30%+", min: 0.30, max: 1.0 },
  ];
  return bins.map((b) => ({
    label: b.label,
    count: results.filter((r) => {
      const ae = Math.abs(r.edge);
      return ae >= b.min && ae < b.max;
    }).length,
  }));
}

// ═══════════════════════════════════════════════════════════
// Main backtest runner
// ═══════════════════════════════════════════════════════════

export async function runStrategyBacktest(userConfig?: BacktestConfig): Promise<BacktestOutput> {
  const startDate = userConfig?.start ?? DEFAULT_START;
  const endDate = userConfig?.end ?? DEFAULT_END;
  const feeBps = userConfig?.feeBps ?? DEFAULT_FEE_BPS;
  const slippageBps = userConfig?.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const baseSizeUsd = userConfig?.baseSizeUsd ?? BASE_SIZE_USD;
  const confidence = userConfig?.confidence ?? USER_CONFIDENCE;

  // 1. Fetch city data sequentially (with per-city parallelism) to avoid 429s
  const cityData = new Map<string, { actuals: { dates: string[]; temps: number[] }; climate: { dates: string[]; temps: number[] } }>();

  for (let ci = 0; ci < CITIES.length; ci++) {
    const city = CITIES[ci];
    // Fetch actuals & climate for one city in parallel (only 2 reqs)
    const [actuals, climate] = await Promise.all([
      fetchDailyMax(city.lat, city.lon, startDate, endDate),
      fetchDailyMax(city.lat, city.lon, CLIMATE_START, CLIMATE_END),
    ]);
    cityData.set(city.name, { actuals, climate });
    // Throttle: wait between cities to stay under rate limit
    if (ci < CITIES.length - 1) await sleep(500);
  }

  // 2. Run both scenarios
  const scenarioDefs = [
    { name: "Climatological Market", description: "Market priced by historical base rates (naive traders)" },
    { name: "Noisy Forecast Market", description: "Market priced by less accurate forecasts (decent traders)" },
  ];

  const scenarios: ScenarioResult[] = [];

  for (const scenarioDef of scenarioDefs) {
    const results: StrategyTradeResult[] = [];

    for (const city of CITIES) {
      const data = cityData.get(city.name)!;
      const { actuals, climate } = data;

      const climateByMonth = new Map<number, number[]>();
      for (let i = 0; i < climate.dates.length; i++) {
        if (climate.temps[i] == null) continue;
        const month = new Date(climate.dates[i]).getMonth();
        if (!climateByMonth.has(month)) climateByMonth.set(month, []);
        climateByMonth.get(month)!.push(climate.temps[i]);
      }

      for (let i = 0; i < actuals.dates.length; i++) {
        const actualC = actuals.temps[i];
        if (actualC == null) continue;
        const date = actuals.dates[i];
        const month = new Date(date).getMonth();
        const monthClimate = climateByMonth.get(month);
        if (!monthClimate || monthClimate.length < 30) continue;

        const buckets = createBuckets(monthClimate);
        if (buckets.length < 3) continue;

        const marketPrices = scenarioDef.name === "Climatological Market"
          ? climatologicalPrices(buckets, monthClimate)
          : noisyForecastPrices(buckets, actualC);

        const ensemble = simulateEnsemble(actualC);
        const modelProbs = buckets.map((b) => ensembleProbability(ensemble.pooled, b));
        const trades = findTrades(buckets, modelProbs, marketPrices, feeBps, slippageBps, baseSizeUsd, confidence);

        for (const trade of trades) {
          const bucketIdx = buckets.findIndex((b) => b.label === trade.bucket_label);
          const bucket = buckets[bucketIdx];
          const resolvedYes = resolvesBucket(actualC, bucket);
          const pnl = computePnl(trade.side, resolvedYes, trade.market_price, trade.size_usd, feeBps, slippageBps);

          results.push({
            ...trade, date, city: city.name,
            resolved_yes: resolvedYes, pnl, won: pnl > 0,
          });
        }
      }
    }

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

  return {
    config: {
      start: startDate,
      end: endDate,
      cities: CITIES.map((c) => c.name),
      baseSize: baseSizeUsd,
      feeBps,
      slippageBps,
      minEdge: MIN_EDGE,
      confidence,
    },
    computedAt: new Date().toISOString(),
    scenarios,
  };
}
