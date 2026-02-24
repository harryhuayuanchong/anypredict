import { NextResponse } from "next/server";
import { getPolymarketAdapter } from "@/lib/trading/polymarket-adapter";

/**
 * POST /api/trading/setup
 * One-time setup: derive API credentials from private key
 * Returns instructions for adding creds to .env
 */
export async function POST() {
  try {
    const adapter = getPolymarketAdapter();

    if (!adapter.isConfigured()) {
      return NextResponse.json(
        {
          error: "POLYMARKET_PRIVATE_KEY not set. Add it to .env first.",
          steps: [
            "1. Generate a Polygon wallet (or use existing)",
            "2. Add POLYMARKET_PRIVATE_KEY=0x... to .env",
            "3. Fund wallet with USDC.e on Polygon",
            "4. Call this endpoint again to derive API credentials",
          ],
        },
        { status: 400 }
      );
    }

    // Initialize and derive creds
    await adapter.initialize();

    // Get balance to verify setup
    const balance = await adapter.getBalance();

    return NextResponse.json({
      success: true,
      wallet_address: balance.address,
      balance_usdc: balance.usdc,
      message:
        "API credentials derived successfully. The adapter stores them in memory. No additional .env changes needed.",
    });
  } catch (err) {
    console.error("Trading setup error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Setup failed" },
      { status: 500 }
    );
  }
}
