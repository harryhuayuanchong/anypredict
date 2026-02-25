import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import type { WeatherStrategyRun, TradePlan } from "@/lib/types";
import {
  type WeatherVariableConfig,
  WEATHER_CONFIGS,
  getConfigForMetric,
} from "@/lib/weather-config";
import { fetchHistoricalEarthquakes } from "@/lib/earthquake";
import { fetchActualGistempAnomaly, resolveMonthFromTitle, resolveYearFromTitle } from "@/lib/gistemp";

/**
 * Fetch actual historical value from Open-Meteo Archive API or USGS.
 * Returns the daily aggregated value for the resolution date at the location.
 */
async function fetchActualValue(
  lat: number,
  lon: number,
  dateStr: string,
  config: WeatherVariableConfig = WEATHER_CONFIGS.temperature,
  eventTitle: string = ""
): Promise<{ actual_value: number; hourly_values: number[]; hourly_times: string[] }> {
  const date = new Date(dateStr);
  const dayStr = date.toISOString().split("T")[0];

  // NASA GISS GISTEMP: fetch published anomaly for the target month/year
  if (config.dataSource === "nasa-giss") {
    const month = eventTitle ? resolveMonthFromTitle(eventTitle) : "Jan";
    const year = eventTitle ? resolveYearFromTitle(eventTitle) : date.getFullYear();
    const anomaly = await fetchActualGistempAnomaly(year, month);
    if (anomaly == null) {
      throw new Error(`NASA GISS anomaly for ${month} ${year} not yet published. Data is typically released 1-2 months after the target month.`);
    }
    return {
      actual_value: anomaly,
      hourly_values: [anomaly],
      hourly_times: [`${year}-${String(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].indexOf(month) + 1).padStart(2, "0")}-01`],
    };
  }

  // Earthquake: query USGS for actual events on that date
  if (config.dataSource === "usgs") {
    const nextDay = new Date(date.getTime() + 86400000);
    const nextDayStr = nextDay.toISOString().split("T")[0];
    const events = await fetchHistoricalEarthquakes(lat, lon, 250, 1);
    // Filter to the specific day
    const dayEvents = events.filter((e) => {
      const eDate = new Date(e.time).toISOString().split("T")[0];
      return eDate >= dayStr && eDate < nextDayStr;
    });
    const maxMag = dayEvents.length > 0 ? Math.max(...dayEvents.map((e) => e.magnitude)) : 0;
    return {
      actual_value: maxMag,
      hourly_values: dayEvents.map((e) => e.magnitude),
      hourly_times: dayEvents.map((e) => new Date(e.time).toISOString()),
    };
  }

  // Open-Meteo Archive API
  const archiveDaily = config.archiveDailyVar;
  const archiveHourly = config.archiveHourlyVar ?? config.forecastHourlyVar;

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("start_date", dayStr);
  url.searchParams.set("end_date", dayStr);
  url.searchParams.set("daily", archiveDaily);
  url.searchParams.set("hourly", archiveHourly);
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo Archive API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  const actualValue = data.daily?.[archiveDaily]?.[0];

  if (actualValue == null) {
    throw new Error(`No historical ${config.metric} data available for this date. Data may not be available yet (usually 5+ days delay).`);
  }

  return {
    actual_value: actualValue,
    hourly_values: data.hourly?.[archiveHourly] ?? [],
    hourly_times: data.hourly?.time ?? [],
  };
}

/**
 * Determine if the market resolved YES based on actual temperature and rule.
 * For Polymarket temp markets, resolution is typically based on daily high.
 */
function resolveMarket(
  actualTempMax: number,
  ruleType: string,
  thresholdLow: number | null,
  thresholdHigh: number | null
): boolean {
  if (ruleType === "above_below") {
    if (thresholdLow != null && thresholdHigh == null) {
      // "≥ X" market → YES if actual_max ≥ threshold_low
      return actualTempMax >= thresholdLow;
    } else if (thresholdHigh != null && thresholdLow == null) {
      // "≤ X" market → YES if actual_max ≤ threshold_high
      return actualTempMax <= thresholdHigh;
    } else {
      // Fallback
      const threshold = thresholdHigh ?? thresholdLow ?? 0;
      return actualTempMax > threshold;
    }
  } else {
    // Range: YES if low ≤ actual_max ≤ high
    const low = thresholdLow ?? -Infinity;
    const high = thresholdHigh ?? Infinity;
    return actualTempMax >= low && actualTempMax <= high;
  }
}

/**
 * Calculate P&L for a single run.
 *
 * Prediction market P&L logic:
 * - If we BUY YES at price P: cost = P * size
 *   - If resolves YES: payout = 1 * size → profit = (1 - P) * size
 *   - If resolves NO:  payout = 0        → loss   = -P * size
 * - If we BUY NO at price (1-P): cost = (1-P) * size
 *   - If resolves NO:  payout = 1 * size → profit = P * size
 *   - If resolves YES: payout = 0        → loss   = -(1-P) * size
 * - If NO_TRADE: P&L = 0
 *
 * Fees and slippage are deducted from gross P&L.
 */
function calculatePnl(
  recommendation: string,
  resolvedYes: boolean,
  yesPrice: number,
  suggestedSize: number,
  feeBps: number,
  slippageBps: number
): number {
  if (recommendation === "NO_TRADE" || suggestedSize === 0) return 0;

  const totalCostRate = (feeBps + slippageBps) / 10000;
  let grossPnl: number;

  if (recommendation === "BUY_YES") {
    if (resolvedYes) {
      grossPnl = (1 - yesPrice) * suggestedSize;
    } else {
      grossPnl = -yesPrice * suggestedSize;
    }
  } else {
    // BUY_NO
    const noPrice = 1 - yesPrice;
    if (!resolvedYes) {
      grossPnl = (1 - noPrice) * suggestedSize;
    } else {
      grossPnl = -noPrice * suggestedSize;
    }
  }

  // Deduct fees on the position size (paid on entry)
  const fees = totalCostRate * suggestedSize;
  return Math.round((grossPnl - fees) * 100) / 100;
}

export async function POST(request: NextRequest) {
  try {
    const { run_id } = await request.json();

    if (!run_id) {
      return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: run, error } = await supabase
      .from("weather_strategy_runs")
      .select("*")
      .eq("id", run_id)
      .single();

    if (error || !run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const r = run as WeatherStrategyRun;

    // Check if resolution time has passed
    if (new Date(r.resolution_time) > new Date()) {
      return NextResponse.json(
        { error: "Resolution time hasn't passed yet. Cannot backtest." },
        { status: 400 }
      );
    }

    if (!r.lat || !r.lon) {
      return NextResponse.json(
        { error: "Missing lat/lon for this run" },
        { status: 400 }
      );
    }

    // Derive config from run's weather_metric (defaults to temperature for legacy runs)
    const config = getConfigForMetric(r.weather_metric ?? "temperature");

    // Fetch actual historical value
    const actual = await fetchActualValue(r.lat, r.lon, r.resolution_time, config, r.market_title);
    const actualValue = actual.actual_value;

    // Resolve the market
    const resolvedYes = resolveMarket(
      actualValue,
      r.rule_type,
      r.threshold_low,
      r.threshold_high
    );

    // Calculate P&L
    const tp = r.trade_plan as TradePlan | null;
    const suggestedSize = tp?.suggested_size_usd ?? 0;
    const pnl = calculatePnl(
      r.recommendation ?? "NO_TRADE",
      resolvedYes,
      r.yes_price,
      suggestedSize,
      r.fee_bps,
      r.slippage_bps
    );

    // Save to DB — try with new column, fall back without if migration not applied
    const updateFields = {
      actual_temp: actualValue, // backward compat column
      actual_value: actualValue,
      resolved_yes: resolvedYes,
      pnl,
      backtested_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("weather_strategy_runs")
      .update(updateFields)
      .eq("id", run_id);

    if (updateError && updateError.message?.includes("actual_value")) {
      // Migration not applied — strip new column and retry
      console.warn("actual_value column missing, updating without it. Run migration_005_weather_metric.sql.");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { actual_value, ...fallbackFields } = updateFields;
      const { error: e2 } = await supabase
        .from("weather_strategy_runs")
        .update(fallbackFields)
        .eq("id", run_id);
      if (e2) {
        return NextResponse.json(
          { error: `Failed to save backtest: ${e2.message}` },
          { status: 500 }
        );
      }
    } else if (updateError) {
      return NextResponse.json(
        { error: `Failed to save backtest: ${updateError.message}` },
        { status: 500 }
      );
    }

    const forecastValue = r.forecast_snapshot?.forecast_value ?? r.forecast_snapshot?.forecast_temp ?? null;

    return NextResponse.json({
      actual_temp: actualValue, // backward compat
      actual_value: actualValue,
      weather_metric: r.weather_metric ?? "temperature",
      weather_unit: config.primaryUnit,
      resolved_yes: resolvedYes,
      pnl,
      forecast_temp: forecastValue, // backward compat
      forecast_value: forecastValue,
      forecast_error: forecastValue != null ? Math.round((actualValue - forecastValue) * 10) / 10 : null,
      actual_hourly: {
        times: actual.hourly_times,
        temps: actual.hourly_values, // backward compat key name
        values: actual.hourly_values,
      },
    });
  } catch (err) {
    console.error("Backtest error:", err);
    return NextResponse.json(
      { error: `Backtest failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
