import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getPolymarketAdapter } from "@/lib/trading/polymarket-adapter";
import { cancelBatchOrders } from "@/lib/trading/auto-trader";

/**
 * POST /api/trading/cancel
 * Cancel order(s)
 * Body: { order_id } or { batch_id } (cancel all for batch)
 */
export async function POST(request: NextRequest) {
  try {
    const { order_id, batch_id } = await request.json();
    const supabase = createServerClient();
    const adapter = getPolymarketAdapter();

    // Cancel all orders in a batch
    if (batch_id) {
      const result = await cancelBatchOrders(adapter, batch_id);
      return NextResponse.json({ batch_id, ...result });
    }

    // Cancel single order
    if (!order_id) {
      return NextResponse.json(
        { error: "Missing order_id or batch_id" },
        { status: 400 }
      );
    }

    // Fetch order
    const { data: order, error } = await supabase
      .from("trade_orders")
      .select("*")
      .eq("id", order_id)
      .single();

    if (error || !order) {
      return NextResponse.json(
        { error: `Order not found: ${order_id}` },
        { status: 404 }
      );
    }

    // If dry-run or no external ID, just mark as cancelled
    if (order.dry_run || !order.external_order_id) {
      const { data: updated } = await supabase
        .from("trade_orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order_id)
        .select()
        .single();

      return NextResponse.json({ order: updated, cancelled: true });
    }

    // Live cancel via adapter
    await adapter.initialize();
    const ok = await adapter.cancelOrder(order.external_order_id);

    if (ok) {
      const { data: updated } = await supabase
        .from("trade_orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order_id)
        .select()
        .single();

      return NextResponse.json({ order: updated, cancelled: true });
    } else {
      return NextResponse.json(
        { error: "Failed to cancel order on platform" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Cancel error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cancel failed" },
      { status: 500 }
    );
  }
}
