/**
 * NASA GISTEMP Global Land-Ocean Temperature Index
 *
 * Fetches and parses the official NASA GISS temperature anomaly data.
 * Resolution source: https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt
 *
 * Values are monthly anomalies (°C) relative to the 1951-1980 baseline.
 * The file format is fixed-width text with values in 0.01°C (e.g. 117 = 1.17°C).
 */

import type {
  PreFetchedWeatherData,
  ForecastSnapshot,
  MultiModelResult,
} from "./types";

const GISTEMP_TXT_URL =
  "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt";

const MONTH_COLS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

type MonthName = (typeof MONTH_COLS)[number];

export interface GistempRecord {
  year: number;
  month: MonthName;
  anomaly: number; // °C
}

// ─── Hardcoded recent February values as fallback ───
// Source: NASA GISS GISTEMP v4, 0.01°C units (converted to °C)
// Used when the NASA server is unreachable
const FALLBACK_FEB_ANOMALIES: { year: number; anomaly: number }[] = [
  { year: 2000, anomaly: 0.54 },
  { year: 2001, anomaly: 0.46 },
  { year: 2002, anomaly: 0.68 },
  { year: 2003, anomaly: 0.59 },
  { year: 2004, anomaly: 0.67 },
  { year: 2005, anomaly: 0.58 },
  { year: 2006, anomaly: 0.62 },
  { year: 2007, anomaly: 0.67 },
  { year: 2008, anomaly: 0.31 },
  { year: 2009, anomaly: 0.49 },
  { year: 2010, anomaly: 0.76 },
  { year: 2011, anomaly: 0.47 },
  { year: 2012, anomaly: 0.42 },
  { year: 2013, anomaly: 0.55 },
  { year: 2014, anomaly: 0.50 },
  { year: 2015, anomaly: 0.86 },
  { year: 2016, anomaly: 1.33 },
  { year: 2017, anomaly: 1.10 },
  { year: 2018, anomaly: 0.88 },
  { year: 2019, anomaly: 0.91 },
  { year: 2020, anomaly: 1.25 },
  { year: 2021, anomaly: 0.69 },
  { year: 2022, anomaly: 0.89 },
  { year: 2023, anomaly: 1.03 },
  { year: 2024, anomaly: 1.76 },
  { year: 2025, anomaly: 1.17 },
];

/**
 * Parse the NASA GISS fixed-width text file.
 *
 * File format:
 *   Line 1: "GLOBAL Land-Ocean Temperature Index in 0.01 degrees Celsius"
 *   Line 2: "            Using ERSST v5"
 *   Line 3: blank
 *   Line 4: header "Year  Jan  Feb  Mar  ..."
 *   Line 5: blank
 *   Lines 6+: "1880  -16  -22  -10  ..."  (values in 0.01°C, *** = missing)
 */
function parseTxtFormat(text: string): GistempRecord[] {
  const records: GistempRecord[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    // Match data rows: start with a 4-digit year
    const trimmed = line.trim();
    if (!/^\d{4}/.test(trimmed)) continue;

    // Split by whitespace
    const parts = trimmed.split(/\s+/);
    if (parts.length < 13) continue; // year + 12 months minimum

    const year = parseInt(parts[0]);
    if (isNaN(year) || year < 1880 || year > 2100) continue;

    for (let m = 0; m < 12; m++) {
      const raw = parts[m + 1];
      if (!raw || raw === "***" || raw === "****") continue;

      const val = parseInt(raw);
      if (isNaN(val)) continue;

      records.push({
        year,
        month: MONTH_COLS[m],
        anomaly: val / 100, // convert from 0.01°C to °C
      });
    }
  }

  return records;
}

/**
 * Fetch all GISTEMP records from NASA GISS.
 * Falls back to hardcoded recent data if the server is unreachable.
 */
export async function fetchGistempData(): Promise<GistempRecord[]> {
  try {
    const res = await fetch(GISTEMP_TXT_URL, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "text/plain" },
    });

    if (!res.ok) {
      throw new Error(`NASA GISS returned ${res.status}`);
    }

    const text = await res.text();
    const records = parseTxtFormat(text);

    if (records.length > 100) {
      return records;
    }

    throw new Error("Parsed too few records from NASA GISS");
  } catch (err) {
    console.warn(
      `NASA GISS fetch failed, using fallback data: ${err instanceof Error ? err.message : err}`
    );
    // Return fallback February data as records
    return FALLBACK_FEB_ANOMALIES.map((f) => ({
      year: f.year,
      month: "Feb" as MonthName,
      anomaly: f.anomaly,
    }));
  }
}

/**
 * Extract anomalies for a specific month from the full dataset.
 */
export function getMonthlyAnomalies(
  records: GistempRecord[],
  month: MonthName
): { year: number; anomaly: number }[] {
  return records
    .filter((r) => r.month === month)
    .map((r) => ({ year: r.year, anomaly: r.anomaly }))
    .sort((a, b) => a.year - b.year);
}

/**
 * Build an ensemble for climate anomaly prediction.
 *
 * Approach:
 * 1. Get historical month anomalies (e.g., all February values)
 * 2. Compute a linear trend from recent decades
 * 3. Generate synthetic members:
 *    - Central value = trend-extrapolated value for target year
 *    - Spread = historical residual standard deviation around the trend
 *    - Sample from Normal(trend_value, residual_std)
 *
 * This accounts for the warming trend rather than naively using all historical values.
 */
export function buildClimateEnsemble(
  monthlyData: { year: number; anomaly: number }[],
  targetYear: number,
  syntheticMembers: number = 1000
): { members: number[]; trendValue: number; residualStd: number } {
  // Use last 30 years for trend fitting (more stable than 20)
  const recentCutoff = targetYear - 30;
  const recent = monthlyData.filter((d) => d.year >= recentCutoff);

  if (recent.length < 5) {
    // Fallback: use all data with no trend adjustment
    const values = monthlyData.map((d) => d.anomaly);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const std = Math.sqrt(
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
    );
    const members = Array.from(
      { length: syntheticMembers },
      () => mean + std * gaussianRandom()
    );
    return { members, trendValue: mean, residualStd: std };
  }

  // Linear regression: anomaly = a + b * (year - baseYear)
  const baseYear = recent[0].year;
  const n = recent.length;
  const xs = recent.map((d) => d.year - baseYear);
  const ys = recent.map((d) => d.anomaly);

  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;

  let ssXY = 0;
  let ssXX = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xs[i] - xMean) * (ys[i] - yMean);
    ssXX += (xs[i] - xMean) ** 2;
  }

  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const intercept = yMean - slope * xMean;

  // Trend value for target year
  const trendValue = intercept + slope * (targetYear - baseYear);

  // Residual standard deviation (how much actual values deviate from trend)
  const residuals = recent.map(
    (d, i) => d.anomaly - (intercept + slope * xs[i])
  );
  const residualStd = Math.sqrt(
    residuals.reduce((s, v) => s + v ** 2, 0) / (n - 2 || 1)
  );

  // Generate ensemble: Normal(trendValue, residualStd)
  const members = Array.from(
    { length: syntheticMembers },
    () => Math.round((trendValue + residualStd * gaussianRandom()) * 100) / 100
  );

  return { members, trendValue: Math.round(trendValue * 100) / 100, residualStd };
}

/** Box-Muller transform for Gaussian random samples */
function gaussianRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Resolve the month name from the event title or resolution time.
 * e.g. "February 2026 Temperature Increase" → "Feb"
 */
export function resolveMonthFromTitle(title: string): MonthName {
  const lower = title.toLowerCase();
  const monthMap: Record<string, MonthName> = {
    january: "Jan", jan: "Jan",
    february: "Feb", feb: "Feb",
    march: "Mar", mar: "Mar",
    april: "Apr", apr: "Apr",
    may: "May",
    june: "Jun", jun: "Jun",
    july: "Jul", jul: "Jul",
    august: "Aug", aug: "Aug",
    september: "Sep", sep: "Sep", sept: "Sep",
    october: "Oct", oct: "Oct",
    november: "Nov", nov: "Nov",
    december: "Dec", dec: "Dec",
  };
  for (const [key, val] of Object.entries(monthMap)) {
    if (lower.includes(key)) return val;
  }
  return "Jan"; // fallback
}

/**
 * Resolve the target year from the event title.
 * e.g. "February 2026 Temperature Increase" → 2026
 */
export function resolveYearFromTitle(title: string): number {
  const match = title.match(/\b(20\d{2})\b/);
  return match ? parseInt(match[1]) : new Date().getFullYear();
}

/**
 * Fetch GISTEMP data and package it as PreFetchedWeatherData
 * for seamless integration with the compute pipeline.
 */
export async function fetchGistempClimateData(
  resolutionTime: string,
  eventTitle: string = ""
): Promise<PreFetchedWeatherData> {
  const records = await fetchGistempData();

  // Determine target month and year
  const targetMonth = eventTitle
    ? resolveMonthFromTitle(eventTitle)
    : (MONTH_COLS[new Date(resolutionTime).getMonth()] ?? "Jan");
  const targetYear = eventTitle
    ? resolveYearFromTitle(eventTitle)
    : new Date(resolutionTime).getFullYear();

  // Extract all values for this month
  const monthlyData = getMonthlyAnomalies(records, targetMonth);

  // Build ensemble with trend adjustment
  const { members, trendValue, residualStd } = buildClimateEnsemble(
    monthlyData,
    targetYear
  );

  const sorted = [...members].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;

  const forecast: ForecastSnapshot = {
    latitude: 0,
    longitude: 0,
    timezone: "UTC",
    hourly_times: [],
    hourly_temps: [],
    target_time: resolutionTime,
    forecast_temp: trendValue,
    forecast_temp_min: null,
    forecast_temp_max: null,
    forecast_value: trendValue,
    hourly_values: null,
    weather_metric: "climate_anomaly",

    // Ensemble fields
    ensemble_members: members,
    ensemble_p10: p10,
    ensemble_p50: p50,
    ensemble_p90: p90,
    ensemble_std: residualStd,
    ensemble_model: "nasa_giss_trend",
    ensemble_member_count: members.length,
    prob_method: "ensemble",
    ensemble_models: [
      {
        model: "nasa_giss_trend",
        members,
        member_count: members.length,
        p10,
        p50,
        p90,
        std: residualStd,
        prob: 0, // filled by compute
      },
    ],
    models_agree: true,
  };

  const multiModel: MultiModelResult = {
    pooled_members: members,
    per_model: [
      {
        members,
        model: "nasa_giss_trend",
        member_count: members.length,
      },
    ],
    total_members: members.length,
    models_label: `NASA GISS ${targetMonth} Trend Model`,
  };

  return {
    forecast,
    multiModel,
    targetDate: resolutionTime.split("T")[0],
  };
}

/**
 * Fetch the actual published GISTEMP anomaly for a specific month/year.
 * Used for backtesting.
 * Returns null if data not yet available.
 */
export async function fetchActualGistempAnomaly(
  year: number,
  month: MonthName
): Promise<number | null> {
  const records = await fetchGistempData();
  const match = records.find((r) => r.year === year && r.month === month);
  return match?.anomaly ?? null;
}
