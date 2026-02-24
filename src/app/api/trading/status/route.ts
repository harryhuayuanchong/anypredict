import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getPolymarketAdapter } from "@/lib/trading/polymarket-adapter";

/**
 * GET /api/trading/status
 * Trading system health check
 */
export async function GET() {
  try {
    const adapter = getPolymarketAdapter();
    const configured = adapter.isConfigured();
    const dryRun = process.env.POLYMARKET_DRY_RUN !== "false";
    const autoTrade = process.env.POLYMARKET_AUTO_TRADE === "true";

    // Basic status (no adapter init needed)
    const status: Record<string, unknown> = {
      configured,
      dry_run: dryRun,
      auto_trade: autoTrade,
      max_position_usd: parseFloat(
        process.env.POLYMARKET_MAX_POSITION_USD || "50"
      ),
      max_total_exposure_usd: parseFloat(
        process.env.POLYMARKET_MAX_TOTAL_EXPOSURE_USD || "500"
      ),
      auto_min_edge: parseFloat(
        process.env.POLYMARKET_AUTO_MIN_EDGE || "0.05"
      ),
      auto_min_conviction: parseInt(
        process.env.POLYMARKET_AUTO_MIN_CONVICTION || "45"
      ),
    };

    // Get open orders count + total exposure
    const supabase = createServerClient();
    const { data: openOrders } = await supabase
      .from("trade_orders")
      .select("size_usd, dry_run")
      .in("status", ["pending", "submitted", "live", "matched"]);

    status.open_orders = openOrders?.length || 0;
    status.total_exposure = openOrders
      ? openOrders
          .filter((o: { dry_run: boolean }) => !o.dry_run)
          .reduce(
            (sum: number, o: { size_usd: number }) =>
              sum + (o.size_usd || 0),
            0
          )
      : 0;

    // Get recent fill stats
    const { data: recentFills } = await supabase
      .from("trade_orders")
      .select("fill_size_usd, dry_run")
      .eq("status", "filled")
      .order("filled_at", { ascending: false })
      .limit(100);

    status.recent_fills = recentFills?.length || 0;
    status.recent_fills_usd = recentFills
      ? recentFills.reduce(
          (sum: number, o: { fill_size_usd: number | null }) =>
            sum + (o.fill_size_usd || 0),
          0
        )
      : 0;

    // Try to get balance if configured (don't fail if wallet isn't set up)
    if (configured) {
      try {
        adapter.initWallet();
        const balance = await adapter.getBalance();
        status.balance_usdc = balance.usdc;
        status.wallet_address = balance.address;
      } catch (balanceErr) {
        console.error("Balance fetch error:", balanceErr);
        status.balance_usdc = null;
        status.wallet_address = null;
        status.balance_error = balanceErr instanceof Error
          ? balanceErr.message
          : "Could not fetch balance — check private key and RPC";
      }
    }

    return NextResponse.json(status);
  } catch (err) {
    console.error("Trading status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Status check failed" },
      { status: 500 }
    );
  }
}
