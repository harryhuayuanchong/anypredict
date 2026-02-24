import { NextRequest, NextResponse } from "next/server";
import { computeStrategy } from "@/lib/compute";
import { createServerClient } from "@/lib/supabase";
import type { ComputeInput } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body: ComputeInput = await request.json();

    // Basic validation
    if (!body.market_url || !body.market_title || !body.resolution_time) {
      return NextResponse.json({ error: "Missing market fields" }, { status: 400 });
    }
    if (!body.lat || !body.lon) {
      return NextResponse.json({ error: "Missing location coordinates" }, { status: 400 });
    }
    if (body.yes_price < 0 || body.yes_price > 1) {
      return NextResponse.json({ error: "YES price must be 0-1" }, { status: 400 });
    }

    // Compute strategy
    const result = await computeStrategy(body);

    // Save to Supabase
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("weather_strategy_runs")
      .insert({
        market_url: body.market_url,
        market_title: body.market_title,
        resolution_time: body.resolution_time,
        location_text: body.location_text,
        lat: body.lat,
        lon: body.lon,
        rule_type: body.rule_type,
        threshold_low: body.threshold_low,
        threshold_high: body.threshold_high,
        yes_price: body.yes_price,
        no_price: body.no_price,
        fee_bps: body.fee_bps,
        slippage_bps: body.slippage_bps,
        base_size_usd: body.base_size_usd,
        user_confidence: body.user_confidence,
        sigma_temp: body.sigma_temp,
        forecast_source: body.forecast_source,
        forecast_snapshot: result.forecast_snapshot,
        model_prob: result.model_prob,
        market_implied_prob: result.market_implied_prob,
        edge: result.edge,
        recommendation: result.recommendation,
        trade_plan: result.trade_plan,
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ run: data, result });
  } catch (err) {
    console.error("Compute error:", err);
    return NextResponse.json(
      { error: `Compute failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
