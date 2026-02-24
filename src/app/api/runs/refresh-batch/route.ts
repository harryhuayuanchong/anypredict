import { NextRequest, NextResponse } from "next/server";
import { computeStrategyFromData, fetchWeatherData } from "@/lib/compute";
import { createServerClient } from "@/lib/supabase";
import type { ComputeInput, WeatherStrategyRun } from "@/lib/types";
import {
  extractSlugFromUrl,
  parseTemperatureFromQuestion,
} from "@/lib/polymarket";

/**
 * POST /api/runs/refresh-batch
 *
 * Re-fetches latest prices from Polymarket Gamma API for all runs in a batch,
 * recomputes edges/Kelly/recommendation with fresh prices + fresh weather data,
 * and updates all runs in the database.
 */
export async function POST(request: NextRequest) {
  try {
    const { batch_id } = await request.json();

    if (!batch_id) {
      return NextResponse.json({ error: "Missing batch_id" }, { status: 400 });
    }

    // 1. Fetch all runs in this batch
    const supabase = createServerClient();
    const { data: rawRuns, error: fetchError } = await supabase
      .from("weather_strategy_runs")
      .select("*")
      .eq("batch_id", batch_id);

    if (fetchError || !rawRuns || rawRuns.length === 0) {
      return NextResponse.json(
        { error: "Batch not found or empty" },
        { status: 404 }
      );
    }

    const runs = rawRuns as WeatherStrategyRun[];
    const firstRun = runs[0];

    // 2. Re-fetch latest prices from Polymarket Gamma API
    const slug = extractSlugFromUrl(firstRun.market_url);
    let freshPrices: Map<string, { yes_price: number; no_price: number }> | null = null;

    if (slug) {
      try {
        const gammaRes = await fetch(
          `https://gamma-api.polymarket.com/events/slug/${slug}`,
          { headers: { Accept: "application/json" } }
        );
        if (gammaRes.ok) {
          const event = await gammaRes.json();
          const markets = event.markets || [];
          freshPrices = new Map();

          for (const m of markets) {
            const question = m.question || m.groupItemTitle || "";
            const parsed = parseTemperatureFromQuestion(question);

            let yesPrice = 0.5;
            let noPrice = 0.5;
            try {
              if (m.outcomePrices) {
                const prices =
                  typeof m.outcomePrices === "string"
                    ? JSON.parse(m.outcomePrices)
                    : m.outcomePrices;
                yesPrice = parseFloat(prices[0]) || 0.5;
                noPrice = parseFloat(prices[1]) || 0.5;
              }
            } catch {
              // fallback
            }

            // Match by threshold values to pair with existing runs
            if (parsed) {
              const key = `${parsed.rule_type}:${parsed.threshold_low_c}:${parsed.threshold_high_c}`;
              freshPrices.set(key, { yes_price: yesPrice, no_price: noPrice });
            }
          }
        }
      } catch {
        // Gamma API failed — will use existing prices
      }
    }

    // 3. Re-fetch fresh weather data (single call for shared location + date)
    const weatherData = await fetchWeatherData(
      firstRun.lat ?? 0,
      firstRun.lon ?? 0,
      firstRun.resolution_time,
      3 // default time window
    );

    // 4. Recompute each run with latest prices + fresh weather
    const updates: {
      id: string;
      yes_price: number;
      no_price: number;
      model_prob: number;
      market_implied_prob: number;
      edge: number;
      recommendation: string;
      trade_plan: unknown;
      forecast_snapshot: unknown;
    }[] = [];

    for (const run of runs) {
      // Try to get fresh prices for this run
      let yesPrice = run.yes_price;
      let noPrice = run.no_price;

      if (freshPrices) {
        const key = `${run.rule_type}:${run.threshold_low}:${run.threshold_high}`;
        const fresh = freshPrices.get(key);
        if (fresh) {
          yesPrice = fresh.yes_price;
          noPrice = fresh.no_price;
        }
      }

      const input: ComputeInput = {
        market_url: run.market_url,
        market_title: run.market_title,
        resolution_time: run.resolution_time,
        location_text: run.location_text,
        lat: run.lat ?? 0,
        lon: run.lon ?? 0,
        rule_type: run.rule_type,
        threshold_low: run.threshold_low,
        threshold_high: run.threshold_high,
        yes_price: yesPrice,
        no_price: noPrice,
        fee_bps: run.fee_bps,
        slippage_bps: run.slippage_bps,
        base_size_usd: run.base_size_usd,
        user_confidence: run.user_confidence,
        sigma_temp: run.sigma_temp,
        forecast_source: run.forecast_source,
        time_window_hours: 3,
        min_edge: 0.05,
      };

      const result = computeStrategyFromData(input, weatherData);

      updates.push({
        id: run.id,
        yes_price: yesPrice,
        no_price: noPrice,
        model_prob: result.model_prob,
        market_implied_prob: result.market_implied_prob,
        edge: result.edge,
        recommendation: result.recommendation,
        trade_plan: result.trade_plan,
        forecast_snapshot: result.forecast_snapshot,
      });
    }

    // 5. Update all runs in DB
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from("weather_strategy_runs")
        .update({
          yes_price: update.yes_price,
          no_price: update.no_price,
          model_prob: update.model_prob,
          market_implied_prob: update.market_implied_prob,
          edge: update.edge,
          recommendation: update.recommendation,
          trade_plan: update.trade_plan,
          forecast_snapshot: update.forecast_snapshot,
        })
        .eq("id", update.id);

      if (updateError) {
        console.error(`Failed to update run ${update.id}:`, updateError);
      }
    }

    // 6. Count price changes for response
    let priceChanges = 0;
    for (let i = 0; i < runs.length; i++) {
      if (
        runs[i].yes_price !== updates[i].yes_price ||
        runs[i].no_price !== updates[i].no_price
      ) {
        priceChanges++;
      }
    }

    return NextResponse.json({
      batch_id,
      updated_count: updates.length,
      price_changes: priceChanges,
      refreshed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Refresh batch error:", err);
    return NextResponse.json(
      {
        error: `Refresh failed: ${err instanceof Error ? err.message : err}`,
      },
      { status: 500 }
    );
  }
}
