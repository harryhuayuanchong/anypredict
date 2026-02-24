import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * GET /api/trading/orders
 * List trade orders, filterable by batch_id, run_id, status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id");
    const runId = searchParams.get("run_id");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");

    const supabase = createServerClient();
    let query = supabase
      .from("trade_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (batchId) query = query.eq("batch_id", batchId);
    if (runId) query = query.eq("run_id", runId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `DB error: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ orders: data || [] });
  } catch (err) {
    console.error("Orders fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch orders" },
      { status: 500 }
    );
  }
}
