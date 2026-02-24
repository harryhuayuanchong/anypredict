import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import type { WeatherStrategyRun, TradePlan } from "@/lib/types";

/**
 * Fetch actual historical temperature from Open-Meteo Archive API.
 * Returns the daily max temperature for the resolution date at the location.
 * (Polymarket weather markets typically resolve on "highest temperature of the day")
 */
async function fetchActualTemperature(
  lat: number,
  lon: number,
  dateStr: string
): Promise<{ temp_max: number; temp_min: number; hourly_temps: number[]; hourly_times: string[] }> {
  const date = new Date(dateStr);
  const dayStr = date.toISOString().split("T")[0];

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("start_date", dayStr);
  url.searchParams.set("end_date", dayStr);
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("hourly", "temperature_2m");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo Archive API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  const tempMax = data.daily?.temperature_2m_max?.[0];
  const tempMin = data.daily?.temperature_2m_min?.[0];

  if (tempMax == null) {
    throw new Error("No historical temperature data available for this date. Data may not be available yet (usually 5+ days delay).");
  }

  return {
    temp_max: tempMax,
    temp_min: tempMin,
    hourly_temps: data.hourly?.temperature_2m ?? [],
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

    // Fetch actual historical temperature
    const actual = await fetchActualTemperature(r.lat, r.lon, r.resolution_time);

    // Use daily max (Polymarket weather = "highest temperature")
    const actualTemp = actual.temp_max;

    // Resolve the market
    const resolvedYes = resolveMarket(
      actualTemp,
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

    // Save to DB
    const { error: updateError } = await supabase
      .from("weather_strategy_runs")
      .update({
        actual_temp: actualTemp,
        resolved_yes: resolvedYes,
        pnl,
        backtested_at: new Date().toISOString(),
      })
      .eq("id", run_id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to save backtest: ${updateError.message}` },
        { status: 500 }
      );
    }

    const forecastTemp = r.forecast_snapshot?.forecast_temp ?? null;

    return NextResponse.json({
      actual_temp: actualTemp,
      resolved_yes: resolvedYes,
      pnl,
      forecast_temp: forecastTemp,
      forecast_error: forecastTemp != null ? Math.round((actualTemp - forecastTemp) * 10) / 10 : null,
      actual_hourly: {
        times: actual.hourly_times,
        temps: actual.hourly_temps,
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
