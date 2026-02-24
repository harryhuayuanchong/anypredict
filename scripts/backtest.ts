#!/usr/bin/env npx tsx
/**
 * AnyPredict Historical Strategy Backtest
 * ========================================
 *
 * Tests the weather forecast edge trading strategy over ~6 months of data.
 *
 * WHAT'S REAL:
 *   - Actual daily max temperatures (Open-Meteo Archive API)
 *   - Temperature bucket structure (matches Polymarket format)
 *   - Strategy logic (same algorithms as the app)
 *
 * WHAT'S SIMULATED:
 *   - Ensemble forecasts: actual temp + calibrated noise based on known
 *     ECMWF/GFS 1-day-ahead error distributions (MAE ~1.0-1.5°C)
 *   - Market prices: Two scenarios tested:
 *     1. Climatological market (prices from historical base rates)
 *     2. Noisy-forecast market (prices from a less accurate forecast model)
 *
 * WHY SIMULATED:
 *   - Historical Polymarket prices aren't available via API
 *   - Historical ensemble forecasts require a paid archive subscription
 *   - The simulation uses well-established NWP error statistics
 *
 * RUN: npx tsx scripts/backtest.ts
 */

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

// Backtest period
const BACKTEST_START = "2025-08-15";
const BACKTEST_END = "2026-02-15"; // ~6 months

// Climatology reference period (5 years for base rates)
const CLIMATE_START = "2019-01-01";
const CLIMATE_END = "2024-12-31";

// Strategy parameters (same as app defaults)
const BASE_SIZE_USD = 100;
const FEE_BPS = 100; // 1%
const SLIPPAGE_BPS = 50; // 0.5%
const MIN_EDGE = 0.03; // 3% minimum edge to trade
const USER_CONFIDENCE = 70; // 70%
const BUCKET_WIDTH_F = 2; // 2°F per bucket

// Forecast simulation (based on published NWP verification stats)
// See: ECMWF Annual Report, GFS verification scores
const OUR_FORECAST_BIAS_STD = 0.8; // °C, systematic forecast bias std
const ECMWF_MEMBER_SPREAD = 1.0; // °C, intra-ensemble spread
const GFS_MEMBER_SPREAD = 1.3; // °C, intra-ensemble spread (slightly wider)
const ECMWF_MEMBERS = 51;
const GFS_MEMBERS = 31;

// Market simulation
const MARKET_FORECAST_BIAS_STD = 1.8; // °C, market's forecast is noisier
const MARKET_UNCERTAINTY_SIGMA = 2.5; // °C, market's wider prob distribution

// Max trades per event-date (realistic: you wouldn't trade all 15 buckets)
const MAX_TRADES_PER_EVENT = 3;

// ═══════════════════════════════════════════════════════════
// Type definitions
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
  market_price: number; // YES price
  edge: number;
  kelly: number;
  size_usd: number;
}

interface TradeResult extends Trade {
  resolved_yes: boolean;
  pnl: number;
  won: boolean;
}

// ═══════════════════════════════════════════════════════════
// Math utilities
// ═══════════════════════════════════════════════════════════

function cToF(c: number): number {
  return c * 9 / 5 + 32;
}
function fToC(f: number): number {
  return (f - 32) * 5 / 9;
}

/** Box-Muller transform for Gaussian random numbers */
function gaussianRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Normal CDF (Abramowitz & Stegun) */
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
// Data fetching
// ═══════════════════════════════════════════════════════════

/** Fetch daily max temperatures from Open-Meteo Archive */
async function fetchDailyMax(
  lat: number, lon: number, start: string, end: string
): Promise<{ dates: string[]; temps: number[] }> {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_max&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Archive API error: ${res.status} for ${start}→${end}`);
  const data = await res.json();

  return {
    dates: data.daily.time,
    temps: data.daily.temperature_2m_max,
  };
}

// ═══════════════════════════════════════════════════════════
// Bucket creation
// ═══════════════════════════════════════════════════════════

/** Create Polymarket-style temperature buckets for a given month */
function createBuckets(climateTempsC: number[]): Bucket[] {
  const tempsF = climateTempsC.map(cToF);
  const p5 = percentile(tempsF, 5);
  const p95 = percentile(tempsF, 95);

  // Round to nearest even number for clean bucket boundaries
  const minF = Math.floor(p5 / BUCKET_WIDTH_F) * BUCKET_WIDTH_F;
  const maxF = Math.ceil(p95 / BUCKET_WIDTH_F) * BUCKET_WIDTH_F;

  const buckets: Bucket[] = [];

  // Bottom catch-all: "≤ minF"
  buckets.push({
    label: `≤${minF}°F`,
    rule_type: "above_below",
    threshold_low_c: null,
    threshold_high_c: fToC(minF),
    low_f: null,
    high_f: minF,
  });

  // Range buckets: "minF+1 to minF+2", etc.
  for (let f = minF + 1; f < maxF; f += BUCKET_WIDTH_F) {
    const hiF = f + BUCKET_WIDTH_F - 1;
    buckets.push({
      label: `${f}-${hiF}°F`,
      rule_type: "range",
      threshold_low_c: fToC(f),
      threshold_high_c: fToC(hiF),
      low_f: f,
      high_f: hiF,
    });
  }

  // Top catch-all: "≥ maxF"
  buckets.push({
    label: `≥${maxF}°F`,
    rule_type: "above_below",
    threshold_low_c: fToC(maxF),
    threshold_high_c: null,
    low_f: maxF,
    high_f: null,
  });

  return buckets;
}

/** Check if actual temperature resolves YES for a bucket */
function resolvesBucket(actualC: number, bucket: Bucket): boolean {
  const actualF = cToF(actualC);
  if (bucket.rule_type === "above_below") {
    if (bucket.threshold_low_c != null && bucket.threshold_high_c == null) {
      return actualF >= bucket.low_f!;
    } else if (bucket.threshold_high_c != null && bucket.threshold_low_c == null) {
      return actualF <= bucket.high_f!;
    }
    return false;
  } else {
    return actualF >= bucket.low_f! && actualF <= bucket.high_f!;
  }
}

// ═══════════════════════════════════════════════════════════
// Market price simulation
// ═══════════════════════════════════════════════════════════

/** Climatological market: prices based on historical base rates */
function climatologicalPrices(
  buckets: Bucket[],
  climateTempsC: number[]
): number[] {
  const n = climateTempsC.length;
  const numBuckets = buckets.length;

  // Count how many climate days fall in each bucket
  const counts = buckets.map((b) => {
    let hits = 0;
    for (const tc of climateTempsC) {
      if (resolvesBucket(tc, b)) hits++;
    }
    return hits;
  });

  // Laplace smoothing + normalize to sum to 1
  const smoothed = counts.map((c) => (c + 0.5) / (n + 0.5 * numBuckets));
  const total = smoothed.reduce((s, v) => s + v, 0);
  return smoothed.map((p) => {
    const price = p / total;
    return Math.max(0.02, Math.min(0.98, price)); // clamp
  });
}

/** Noisy-forecast market: prices based on a less accurate forecast */
function noisyForecastPrices(
  buckets: Bucket[],
  actualC: number
): number[] {
  // Market's forecast = actual + noise (noisier than ours)
  const marketForecast = actualC + gaussianRandom() * MARKET_FORECAST_BIAS_STD;

  // Compute probabilities using normal distribution with wide sigma
  const probs = buckets.map((b) => {
    if (b.rule_type === "above_below") {
      if (b.threshold_low_c != null && b.threshold_high_c == null) {
        return 1 - normalCDF((b.threshold_low_c - marketForecast) / MARKET_UNCERTAINTY_SIGMA);
      } else if (b.threshold_high_c != null && b.threshold_low_c == null) {
        return normalCDF((b.threshold_high_c - marketForecast) / MARKET_UNCERTAINTY_SIGMA);
      }
      return 0.05;
    } else {
      const pLow = normalCDF((b.threshold_low_c! - marketForecast) / MARKET_UNCERTAINTY_SIGMA);
      const pHigh = normalCDF((b.threshold_high_c! - marketForecast) / MARKET_UNCERTAINTY_SIGMA);
      return pHigh - pLow;
    }
  });

  // Normalize to sum to 1 and clamp
  const total = probs.reduce((s, v) => s + v, 0);
  return probs.map((p) => {
    const price = total > 0 ? p / total : 1 / buckets.length;
    return Math.max(0.02, Math.min(0.98, price));
  });
}

// ═══════════════════════════════════════════════════════════
// Ensemble simulation & probability
// ═══════════════════════════════════════════════════════════

/** Simulate ensemble members for a given actual temperature */
function simulateEnsemble(actualC: number): {
  pooled: number[];
  ecmwf: number[];
  gfs: number[];
} {
  // Our forecast mean = actual + small bias
  const forecastMean = actualC + gaussianRandom() * OUR_FORECAST_BIAS_STD;

  // ECMWF ensemble: 51 members spread around forecast mean
  const ecmwf: number[] = [];
  for (let i = 0; i < ECMWF_MEMBERS; i++) {
    ecmwf.push(forecastMean + gaussianRandom() * ECMWF_MEMBER_SPREAD);
  }

  // GFS ensemble: 31 members with slightly wider spread
  const gfs: number[] = [];
  for (let i = 0; i < GFS_MEMBERS; i++) {
    gfs.push(forecastMean + gaussianRandom() * GFS_MEMBER_SPREAD);
  }

  return { pooled: [...ecmwf, ...gfs], ecmwf, gfs };
}

/** Empirical probability from ensemble with Laplace smoothing */
function ensembleProbability(members: number[], bucket: Bucket): number {
  const n = members.length;
  if (n === 0) return 0.5;

  let hits = 0;
  for (const temp of members) {
    if (resolvesBucket(temp, bucket)) hits++;
  }

  return (hits + 1) / (n + 2);
}

// ═══════════════════════════════════════════════════════════
// Kelly criterion & trade logic
// ═══════════════════════════════════════════════════════════

function kellyFraction(
  modelProb: number,
  marketPrice: number,
  side: "BUY_YES" | "BUY_NO",
  feeFrac: number
): number {
  let kelly: number;
  if (side === "BUY_YES") {
    const effectivePrice = marketPrice + feeFrac;
    if (effectivePrice >= 1) return 0;
    kelly = (modelProb - effectivePrice) / (1 - effectivePrice);
  } else {
    const effectivePrice = (1 - marketPrice) + feeFrac;
    if (effectivePrice >= 1) return 0;
    kelly = ((1 - modelProb) - effectivePrice) / (1 - effectivePrice);
  }
  return Math.max(0, Math.min(0.25, kelly));
}

function computePnl(
  side: "BUY_YES" | "BUY_NO",
  resolvedYes: boolean,
  yesPrice: number,
  size: number,
  feeBps: number,
  slippageBps: number
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

  const fees = totalCostRate * size;
  return Math.round((grossPnl - fees) * 100) / 100;
}

/** Find the best trades for a set of buckets */
function findTrades(
  buckets: Bucket[],
  modelProbs: number[],
  marketPrices: number[]
): Trade[] {
  const feeFrac = (FEE_BPS + SLIPPAGE_BPS) / 10000;
  const candidates: (Trade & { absEdge: number })[] = [];

  for (let i = 0; i < buckets.length; i++) {
    const mp = Math.max(0.01, Math.min(0.99, modelProbs[i]));
    const mktP = marketPrices[i];
    const edge = mp - mktP - feeFrac;

    let side: "BUY_YES" | "BUY_NO" | null = null;
    let tradeEdge = 0;

    if (edge > MIN_EDGE) {
      side = "BUY_YES";
      tradeEdge = edge;
    } else if (edge < -MIN_EDGE) {
      side = "BUY_NO";
      tradeEdge = -edge;
    }

    if (side) {
      const kelly = kellyFraction(mp, mktP, side, feeFrac);
      const kellySize = BASE_SIZE_USD * kelly;
      const halfKellySize = kellySize * 0.5;
      const size = Math.round(halfKellySize * (USER_CONFIDENCE / 100) * 100) / 100;

      if (size >= 1) { // minimum $1 trade
        candidates.push({
          date: "",
          city: "",
          bucket_label: buckets[i].label,
          side,
          model_prob: mp,
          market_price: mktP,
          edge: side === "BUY_YES" ? edge : -edge,
          kelly,
          size_usd: size,
          absEdge: tradeEdge,
        });
      }
    }
  }

  // Sort by absolute edge, take top N
  candidates.sort((a, b) => b.absEdge - a.absEdge);
  return candidates.slice(0, MAX_TRADES_PER_EVENT);
}

// ═══════════════════════════════════════════════════════════
// Main backtest
// ═══════════════════════════════════════════════════════════

async function runBacktest() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              AnyPredict Strategy Backtest                     ║");
  console.log("║              Weather Forecast Edge Trading                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Period: ${BACKTEST_START} → ${BACKTEST_END}`);
  console.log(`Cities: ${CITIES.map((c) => c.name).join(", ")}`);
  console.log(`Strategy: ${MIN_EDGE * 100}% min edge, ${FEE_BPS}bp fees + ${SLIPPAGE_BPS}bp slippage, half-Kelly × ${USER_CONFIDENCE}% confidence`);
  console.log(`Base size: $${BASE_SIZE_USD}, Max ${MAX_TRADES_PER_EVENT} trades per event`);
  console.log();

  // ── Step 1: Fetch actual temperatures ──
  console.log("⏳ Fetching actual temperature data...");
  const cityData: Map<string, {
    actuals: { dates: string[]; temps: number[] };
    climate: { dates: string[]; temps: number[] };
  }> = new Map();

  for (const city of CITIES) {
    process.stdout.write(`   ${city.name}...`);

    const actuals = await fetchDailyMax(city.lat, city.lon, BACKTEST_START, BACKTEST_END);

    // Fetch climatology (5 years)
    const climate = await fetchDailyMax(city.lat, city.lon, CLIMATE_START, CLIMATE_END);

    cityData.set(city.name, { actuals, climate });
    console.log(` ✓ (${actuals.dates.length} days, ${climate.dates.length} climate days)`);
  }

  // ── Step 2: Run backtest for each scenario ──
  const scenarios = [
    { name: "Climatological Market", description: "Market priced by historical base rates (naive traders)" },
    { name: "Noisy Forecast Market", description: "Market priced by less accurate forecasts (decent traders)" },
  ];

  const allResults: Map<string, TradeResult[]> = new Map();

  for (const scenario of scenarios) {
    console.log();
    console.log(`⏳ Running: ${scenario.name}...`);

    const results: TradeResult[] = [];
    let eventCount = 0;

    for (const city of CITIES) {
      const data = cityData.get(city.name)!;
      const { actuals, climate } = data;

      // Group climate data by month for seasonal bucket creation
      const climateByMonth: Map<number, number[]> = new Map();
      for (let i = 0; i < climate.dates.length; i++) {
        if (climate.temps[i] == null) continue;
        const month = new Date(climate.dates[i]).getMonth();
        if (!climateByMonth.has(month)) climateByMonth.set(month, []);
        climateByMonth.get(month)!.push(climate.temps[i]);
      }

      // Process each day in the backtest period
      for (let i = 0; i < actuals.dates.length; i++) {
        const actualC = actuals.temps[i];
        if (actualC == null) continue;

        const date = actuals.dates[i];
        const month = new Date(date).getMonth();
        const monthClimate = climateByMonth.get(month);
        if (!monthClimate || monthClimate.length < 30) continue;

        // Create buckets based on climatology for this month
        const buckets = createBuckets(monthClimate);
        if (buckets.length < 3) continue;

        // Compute market prices based on scenario
        let marketPrices: number[];
        if (scenario.name === "Climatological Market") {
          marketPrices = climatologicalPrices(buckets, monthClimate);
        } else {
          marketPrices = noisyForecastPrices(buckets, actualC);
        }

        // Simulate our ensemble forecast
        const ensemble = simulateEnsemble(actualC);

        // Compute model probability for each bucket
        const modelProbs = buckets.map((b) => ensembleProbability(ensemble.pooled, b));

        // Find best trades
        const trades = findTrades(buckets, modelProbs, marketPrices);
        eventCount++;

        // Resolve and compute P&L
        for (const trade of trades) {
          const bucketIdx = buckets.findIndex((b) => b.label === trade.bucket_label);
          const bucket = buckets[bucketIdx];
          const resolvedYes = resolvesBucket(actualC, bucket);

          const pnl = computePnl(
            trade.side, resolvedYes, trade.market_price,
            trade.size_usd, FEE_BPS, SLIPPAGE_BPS
          );

          const won = pnl > 0;

          results.push({
            ...trade,
            date,
            city: city.name,
            resolved_yes: resolvedYes,
            pnl,
            won,
          });
        }
      }
    }

    allResults.set(scenario.name, results);
    console.log(`   ✓ ${eventCount} events, ${results.length} trades executed`);
  }

  // ── Step 3: Print report ──
  console.log();
  console.log("━".repeat(70));
  console.log("                         BACKTEST RESULTS");
  console.log("━".repeat(70));

  for (const scenario of scenarios) {
    const results = allResults.get(scenario.name)!;
    printScenarioReport(scenario.name, scenario.description, results);
  }

  // ── Step 4: Calibration analysis ──
  console.log();
  console.log("━".repeat(70));
  console.log("                     CALIBRATION ANALYSIS");
  console.log("━".repeat(70));
  console.log();
  console.log("  How accurate are our model probabilities?");
  console.log("  (When we predict X% probability, does it happen ~X% of the time?)");
  console.log();

  // Use the noisy forecast market results for calibration
  const calResults = allResults.get("Noisy Forecast Market")!;
  printCalibration(calResults);

  // ── Step 5: Monthly breakdown ──
  console.log();
  console.log("━".repeat(70));
  console.log("                    MONTHLY P&L BREAKDOWN");
  console.log("━".repeat(70));

  for (const scenario of scenarios) {
    console.log();
    console.log(`  ${scenario.name}:`);
    const results = allResults.get(scenario.name)!;
    printMonthlyBreakdown(results);
  }

  // ── Step 6: Trade type analysis ──
  console.log();
  console.log("━".repeat(70));
  console.log("                   TRADE TYPE ANALYSIS");
  console.log("━".repeat(70));

  for (const scenario of scenarios) {
    console.log();
    console.log(`  ${scenario.name}:`);
    const results = allResults.get(scenario.name)!;
    printTradeTypeAnalysis(results);
  }

  console.log();
  console.log("━".repeat(70));
  console.log("                        METHODOLOGY");
  console.log("━".repeat(70));
  console.log();
  console.log("  Real data:");
  console.log("    • Actual daily max temperatures from Open-Meteo Archive API");
  console.log("    • 5 cities × ~180 days = ~900 event-dates");
  console.log("    • Climatology from 2019-2024 (5 years of historical data)");
  console.log();
  console.log("  Simulated components:");
  console.log(`    • Ensemble forecasts: actual ± N(0, ${OUR_FORECAST_BIAS_STD}°C) bias`);
  console.log(`      ECMWF: ${ECMWF_MEMBERS} members, σ=${ECMWF_MEMBER_SPREAD}°C spread`);
  console.log(`      GFS:   ${GFS_MEMBERS} members, σ=${GFS_MEMBER_SPREAD}°C spread`);
  console.log(`    • Climatological market: historical base rates (5yr)`);
  console.log(`    • Noisy forecast market: forecast with σ=${MARKET_FORECAST_BIAS_STD}°C bias,`);
  console.log(`      ${MARKET_UNCERTAINTY_SIGMA}°C uncertainty (vs our ~1.0-1.3°C)`);
  console.log();
  console.log("  Limitations:");
  console.log("    • No real Polymarket prices (market efficiency is simulated)");
  console.log("    • Ensemble members are synthetic (not actual ECMWF/GFS runs)");
  console.log("    • Assumes sufficient liquidity to execute at simulated prices");
  console.log("    • Results will vary slightly between runs (Monte Carlo)");
  console.log();
}

// ═══════════════════════════════════════════════════════════
// Report printing
// ═══════════════════════════════════════════════════════════

function printScenarioReport(name: string, description: string, results: TradeResult[]) {
  console.log();
  console.log(`┌─ ${name}`);
  console.log(`│  ${description}`);
  console.log("│");

  if (results.length === 0) {
    console.log("│  No trades executed.");
    console.log("└");
    return;
  }

  const totalPnl = results.reduce((s, r) => s + r.pnl, 0);
  const wins = results.filter((r) => r.won).length;
  const losses = results.filter((r) => !r.won && r.pnl < 0).length;
  const winRate = wins / results.length;
  const avgEdge = results.reduce((s, r) => s + Math.abs(r.edge), 0) / results.length;
  const avgPnl = totalPnl / results.length;
  const totalInvested = results.reduce((s, r) => s + r.size_usd, 0);
  const roi = totalPnl / totalInvested;

  // Sharpe ratio (annualized, using daily returns)
  const dailyPnl = new Map<string, number>();
  for (const r of results) {
    dailyPnl.set(r.date, (dailyPnl.get(r.date) || 0) + r.pnl);
  }
  const dailyReturns = [...dailyPnl.values()];
  const meanDaily = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length;
  const stdDaily = Math.sqrt(
    dailyReturns.reduce((s, v) => s + (v - meanDaily) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
  );
  const sharpe = stdDaily > 0 ? (meanDaily / stdDaily) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = 0;
  let cumPnl = 0;
  let maxDD = 0;
  const sortedDates = [...dailyPnl.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, pnl] of sortedDates) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Longest losing streak
  let maxStreak = 0;
  let streak = 0;
  const sortedResults = [...results].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of sortedResults) {
    if (r.pnl < 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }

  // Best and worst trades
  const best = results.reduce((a, b) => a.pnl > b.pnl ? a : b);
  const worst = results.reduce((a, b) => a.pnl < b.pnl ? a : b);

  // Per-city breakdown
  const byCityMap = new Map<string, TradeResult[]>();
  for (const r of results) {
    if (!byCityMap.has(r.city)) byCityMap.set(r.city, []);
    byCityMap.get(r.city)!.push(r);
  }

  const pnlColor = totalPnl >= 0 ? "+" : "";

  console.log(`│  📊 HEADLINE METRICS`);
  console.log(`│`);
  console.log(`│  Total P&L:       ${pnlColor}$${totalPnl.toFixed(2)}`);
  console.log(`│  Total Invested:  $${totalInvested.toFixed(2)}`);
  console.log(`│  ROI:             ${(roi * 100).toFixed(1)}%`);
  console.log(`│  Win Rate:        ${(winRate * 100).toFixed(1)}% (${wins}W / ${losses}L out of ${results.length} trades)`);
  console.log(`│  Avg Edge:        ${(avgEdge * 100).toFixed(1)}%`);
  console.log(`│  Avg Trade P&L:   ${avgPnl >= 0 ? "+" : ""}$${avgPnl.toFixed(2)}`);
  console.log(`│`);
  console.log(`│  📈 RISK METRICS`);
  console.log(`│`);
  console.log(`│  Sharpe Ratio:    ${sharpe.toFixed(2)} (annualized)`);
  console.log(`│  Max Drawdown:    -$${maxDD.toFixed(2)}`);
  console.log(`│  Longest Losing:  ${maxStreak} trades`);
  console.log(`│  Profit Factor:   ${(() => {
    const grossProfit = results.filter(r => r.pnl > 0).reduce((s, r) => s + r.pnl, 0);
    const grossLoss = Math.abs(results.filter(r => r.pnl < 0).reduce((s, r) => s + r.pnl, 0));
    return grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : "∞";
  })()}`);
  console.log(`│`);
  console.log(`│  🏆 NOTABLE TRADES`);
  console.log(`│`);
  console.log(`│  Best:  +$${best.pnl.toFixed(2)} (${best.city}, ${best.date}, ${best.side} ${best.bucket_label})`);
  console.log(`│  Worst: -$${Math.abs(worst.pnl).toFixed(2)} (${worst.city}, ${worst.date}, ${worst.side} ${worst.bucket_label})`);
  console.log(`│`);
  console.log(`│  🏙️  PER-CITY BREAKDOWN`);
  console.log(`│`);

  for (const [cityName, cityResults] of byCityMap) {
    const cityPnl = cityResults.reduce((s, r) => s + r.pnl, 0);
    const cityWins = cityResults.filter((r) => r.won).length;
    const cityWR = cityResults.length > 0 ? (cityWins / cityResults.length * 100).toFixed(0) : "0";
    const pSign = cityPnl >= 0 ? "+" : "";
    console.log(`│  ${cityName.padEnd(15)} ${pSign}$${cityPnl.toFixed(2).padStart(8)}  (${cityWR}% WR, ${cityResults.length} trades)`);
  }

  console.log("└");
}

function printCalibration(results: TradeResult[]) {
  // Group trades by predicted probability buckets
  const calBuckets = [
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

  console.log("  Predicted    Actual     Count  Calibration");
  console.log("  ─────────    ──────     ─────  ───────────");

  for (const cb of calBuckets) {
    // For BUY_YES trades, model_prob is the "YES probability"
    // For BUY_NO trades, we predicted NO would resolve, so YES prob < 50%
    const matching = results.filter((r) => {
      const yesProb = r.model_prob;
      return yesProb >= cb.min && yesProb < cb.max;
    });

    if (matching.length < 5) continue;

    const actualRate = matching.filter((r) => r.resolved_yes).length / matching.length;
    const midpoint = (cb.min + cb.max) / 2;
    const diff = actualRate - midpoint;
    const calLabel = Math.abs(diff) < 0.05 ? "✓ Good" :
      Math.abs(diff) < 0.10 ? "~ Fair" : "✗ Off";

    console.log(
      `  ${cb.label.padEnd(10)}   ${(actualRate * 100).toFixed(0).padStart(3)}%      ${String(matching.length).padStart(4)}   ${calLabel} (${diff > 0 ? "+" : ""}${(diff * 100).toFixed(1)}%)`
    );
  }
}

function printMonthlyBreakdown(results: TradeResult[]) {
  const byMonth = new Map<string, TradeResult[]>();
  for (const r of results) {
    const month = r.date.substring(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(r);
  }

  const months = [...byMonth.keys()].sort();
  let cumPnl = 0;

  console.log("  Month      P&L        WR      Trades  Cumulative");
  console.log("  ─────      ───        ──      ──────  ──────────");

  for (const month of months) {
    const mr = byMonth.get(month)!;
    const pnl = mr.reduce((s, r) => s + r.pnl, 0);
    cumPnl += pnl;
    const wr = mr.filter((r) => r.won).length / mr.length;
    const pSign = pnl >= 0 ? "+" : "";
    const cSign = cumPnl >= 0 ? "+" : "";
    console.log(
      `  ${month}   ${pSign}$${pnl.toFixed(2).padStart(8)}   ${(wr * 100).toFixed(0).padStart(3)}%     ${String(mr.length).padStart(4)}    ${cSign}$${cumPnl.toFixed(2)}`
    );
  }
}

function printTradeTypeAnalysis(results: TradeResult[]) {
  const buyYes = results.filter((r) => r.side === "BUY_YES");
  const buyNo = results.filter((r) => r.side === "BUY_NO");

  for (const [label, trades] of [["BUY YES", buyYes], ["BUY NO", buyNo]] as const) {
    if (trades.length === 0) {
      console.log(`  ${label.padEnd(8)} — No trades`);
      continue;
    }
    const pnl = trades.reduce((s, r) => s + r.pnl, 0);
    const wr = trades.filter((r) => r.won).length / trades.length;
    const avgEdge = trades.reduce((s, r) => s + Math.abs(r.edge), 0) / trades.length;
    const pSign = pnl >= 0 ? "+" : "";
    console.log(
      `  ${label.padEnd(8)} ${String(trades.length).padStart(4)} trades  ${pSign}$${pnl.toFixed(2).padStart(8)}   ${(wr * 100).toFixed(0)}% WR   avg edge ${(avgEdge * 100).toFixed(1)}%`
    );
  }
}

// ═══════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════

runBacktest().catch((err) => {
  console.error("Backtest failed:", err);
  process.exit(1);
});
