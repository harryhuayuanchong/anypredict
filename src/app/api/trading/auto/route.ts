import { NextRequest, NextResponse } from "next/server";
import { getPolymarketAdapter } from "@/lib/trading/polymarket-adapter";
import { evaluateBatch } from "@/lib/trading/auto-trader";
import { pollOpenOrders } from "@/lib/trading/executor";

/**
 * POST /api/trading/auto
 * Run auto-trader for a batch (or poll open orders)
 * Body: { batch_id } or { action: "poll" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const adapter = getPolymarketAdapter();

    // Poll mode — update status of open orders
    if (body.action === "poll") {
      const pollResult = await pollOpenOrders(adapter);
      return NextResponse.json({ action: "poll", ...pollResult });
    }

    // Auto-evaluate a batch
    if (!body.batch_id) {
      return NextResponse.json(
        { error: "Missing batch_id" },
        { status: 400 }
      );
    }

    if (process.env.POLYMARKET_AUTO_TRADE !== "true") {
      return NextResponse.json(
        { error: "Auto-trading is disabled. Set POLYMARKET_AUTO_TRADE=true to enable." },
        { status: 403 }
      );
    }

    const actions = await evaluateBatch(adapter, body.batch_id);

    const executed = actions.filter((a) => a.action === "executed").length;
    const skipped = actions.filter((a) => a.action === "skipped").length;

    return NextResponse.json({
      batch_id: body.batch_id,
      total: actions.length,
      executed,
      skipped,
      actions,
    });
  } catch (err) {
    console.error("Auto-trade error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Auto-trade failed" },
      { status: 500 }
    );
  }
}
