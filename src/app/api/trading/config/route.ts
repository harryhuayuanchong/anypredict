import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/trading/config
 * Return current runtime trading configuration
 */
export async function GET() {
  return NextResponse.json({
    dry_run: process.env.POLYMARKET_DRY_RUN !== "false",
    auto_trade: process.env.POLYMARKET_AUTO_TRADE === "true",
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
  });
}

/**
 * POST /api/trading/config
 * Update runtime trading configuration (process.env override, reverts on restart)
 *
 * Body: { dry_run?: boolean, confirm?: boolean }
 * - Switching to live (dry_run: false) requires confirm: true
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Handle dry_run toggle
    if (typeof body.dry_run === "boolean") {
      // Switching to LIVE requires explicit confirmation
      if (!body.dry_run && !body.confirm) {
        return NextResponse.json(
          {
            error: "Switching to LIVE mode requires confirmation",
            require_confirm: true,
          },
          { status: 400 }
        );
      }

      process.env.POLYMARKET_DRY_RUN = body.dry_run ? "true" : "false";
    }

    // Return updated config
    return NextResponse.json({
      dry_run: process.env.POLYMARKET_DRY_RUN !== "false",
      auto_trade: process.env.POLYMARKET_AUTO_TRADE === "true",
      max_position_usd: parseFloat(
        process.env.POLYMARKET_MAX_POSITION_USD || "50"
      ),
      max_total_exposure_usd: parseFloat(
        process.env.POLYMARKET_MAX_TOTAL_EXPOSURE_USD || "500"
      ),
    });
  } catch (err) {
    console.error("Config update error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Config update failed" },
      { status: 500 }
    );
  }
}
