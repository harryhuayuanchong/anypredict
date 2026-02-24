import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getPolymarketAdapter } from "@/lib/trading/polymarket-adapter";
import { executeTrade } from "@/lib/trading/executor";
import type { WeatherStrategyRun } from "@/lib/types";
import type { OrderOutcome } from "@/lib/trading/types";

/**
 * POST /api/trading/execute
 * Execute a trade for a single strategy run
 * Body: { run_id, outcome?: "YES"|"NO", order_type?: "GTC"|"GTD"|"FOK" }
 */
export async function POST(request: NextRequest) {
  try {
    const { run_id, outcome, order_type } = await request.json();

    if (!run_id) {
      return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    }

    // Fetch the run
    const supabase = createServerClient();
    const { data: run, error } = await supabase
      .from("weather_strategy_runs")
      .select("*")
      .eq("id", run_id)
      .single();

    if (error || !run) {
      return NextResponse.json(
        { error: `Run not found: ${run_id}` },
        { status: 404 }
      );
    }

    const typedRun = run as WeatherStrategyRun;

    // Determine outcome from recommendation if not provided
    const resolvedOutcome: OrderOutcome =
      outcome ||
      (typedRun.recommendation === "BUY_YES" ? "YES" : "NO");

    // Get token ID
    const tokenId =
      resolvedOutcome === "YES"
        ? typedRun.clob_token_id_yes
        : typedRun.clob_token_id_no;

    if (!tokenId) {
      return NextResponse.json(
        { error: `Missing ${resolvedOutcome} token ID for this run` },
        { status: 400 }
      );
    }

    const price =
      resolvedOutcome === "YES" ? typedRun.yes_price : typedRun.no_price;

    const sizeUsd =
      typedRun.trade_plan?.half_kelly_size_usd ||
      typedRun.trade_plan?.suggested_size_usd ||
      0;

    if (sizeUsd <= 0) {
      return NextResponse.json(
        { error: "No suggested trade size" },
        { status: 400 }
      );
    }

    const adapter = getPolymarketAdapter();

    const result = await executeTrade(adapter, {
      run_id: typedRun.id,
      batch_id: typedRun.batch_id,
      platform: "polymarket",
      market_id: typedRun.condition_id || typedRun.id,
      token_id: tokenId,
      outcome: resolvedOutcome,
      price,
      size_usd: sizeUsd,
      order_type: order_type || "GTC",
      neg_risk: typedRun.neg_risk,
      tick_size: "0.01",
      edge: typedRun.edge || 0,
      model_prob: typedRun.model_prob || 0,
      market_price: price,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Trade execute error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Trade execution failed" },
      { status: 500 }
    );
  }
}
