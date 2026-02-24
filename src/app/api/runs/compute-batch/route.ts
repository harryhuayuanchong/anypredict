import { NextRequest, NextResponse } from "next/server";
import { computeBatch } from "@/lib/compute";
import { createServerClient } from "@/lib/supabase";
import type { BatchComputeInput } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body: BatchComputeInput = await request.json();

    // Validation
    if (!body.event_url || !body.event_title || !body.resolution_time) {
      return NextResponse.json({ error: "Missing event fields" }, { status: 400 });
    }
    if (!body.lat || !body.lon) {
      return NextResponse.json({ error: "Missing coordinates" }, { status: 400 });
    }
    if (!body.sub_markets || body.sub_markets.length === 0) {
      return NextResponse.json({ error: "No sub-markets to compute" }, { status: 400 });
    }

    // Compute all at once (1 forecast fetch, 1 ensemble fetch, N probability calcs)
    const results = await computeBatch(body);

    // Generate batch ID
    const batch_id = crypto.randomUUID();

    // Save all runs to DB in one batch insert
    const supabase = createServerClient();
    const rows = body.sub_markets.map((sm, i) => ({
      market_url: body.event_url,
      market_title: `${body.event_title} — ${sm.question}`,
      resolution_time: body.resolution_time,
      location_text: body.location_text,
      lat: body.lat,
      lon: body.lon,
      rule_type: sm.rule_type,
      threshold_low: sm.threshold_low,
      threshold_high: sm.threshold_high,
      yes_price: sm.yes_price,
      no_price: sm.no_price,
      fee_bps: body.fee_bps,
      slippage_bps: body.slippage_bps,
      base_size_usd: body.base_size_usd,
      user_confidence: body.user_confidence,
      sigma_temp: body.sigma_temp,
      forecast_source: body.forecast_source,
      forecast_snapshot: results[i].forecast_snapshot,
      model_prob: results[i].model_prob,
      market_implied_prob: results[i].market_implied_prob,
      edge: results[i].edge,
      recommendation: results[i].recommendation,
      trade_plan: results[i].trade_plan,
      batch_id,
      event_slug: body.event_slug,
    }));

    const { data, error } = await supabase
      .from("weather_strategy_runs")
      .insert(rows)
      .select();

    if (error) {
      console.error("Supabase batch insert error:", error);
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    // Build summary response
    const summaryResults = data.map((row: Record<string, unknown>, i: number) => ({
      sub_market_id: body.sub_markets[i].id,
      label: body.sub_markets[i].label,
      question: body.sub_markets[i].question,
      run_id: row.id as string,
      model_prob: results[i].model_prob,
      market_implied_prob: results[i].market_implied_prob,
      edge: results[i].edge,
      recommendation: results[i].recommendation,
      kelly_fraction: results[i].trade_plan.kelly_fraction ?? 0,
      suggested_size_usd: results[i].trade_plan.suggested_size_usd,
      yes_price: body.sub_markets[i].yes_price,
      no_price: body.sub_markets[i].no_price,
    }));

    return NextResponse.json({
      batch_id,
      event_title: body.event_title,
      results: summaryResults,
    });
  } catch (err) {
    console.error("Batch compute error:", err);
    return NextResponse.json(
      { error: `Batch compute failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
