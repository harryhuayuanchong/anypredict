/* ═══════════════════════════════════════════════════════
   Trade Executor
   Central orchestrator — platform-agnostic
   Handles safety checks, dry-run detection, DB persistence
   ═══════════════════════════════════════════════════════ */

import { createServerClient } from "@/lib/supabase";
import type {
  TradingPlatformAdapter,
  TradeExecutionInput,
  TradeOrder,
} from "./types";

interface ExecutorConfig {
  dryRun: boolean;
  maxPositionUsd: number;
  maxTotalExposureUsd: number;
}

function getConfig(): ExecutorConfig {
  return {
    dryRun: process.env.POLYMARKET_DRY_RUN !== "false",
    maxPositionUsd: parseFloat(process.env.POLYMARKET_MAX_POSITION_USD || "50"),
    maxTotalExposureUsd: parseFloat(
      process.env.POLYMARKET_MAX_TOTAL_EXPOSURE_USD || "500"
    ),
  };
}

/** Check total open exposure from existing orders */
async function getTotalOpenExposure(): Promise<number> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("trade_orders")
    .select("size_usd")
    .in("status", ["pending", "submitted", "live", "matched"])
    .eq("dry_run", false);

  if (!data) return 0;
  return data.reduce(
    (sum: number, row: { size_usd: number }) => sum + (row.size_usd || 0),
    0
  );
}

/** Check if a run already has an active order */
async function hasActiveOrder(runId: string): Promise<boolean> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("trade_orders")
    .select("id")
    .eq("run_id", runId)
    .in("status", ["pending", "submitted", "live", "matched"])
    .limit(1);

  return (data?.length || 0) > 0;
}

export interface ExecuteTradeResult {
  order: TradeOrder;
  dryRun: boolean;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Execute a trade for a single strategy run
 *
 * Flow:
 * 1. Safety checks (max position, total exposure, duplicate order)
 * 2. Insert pending order to DB
 * 3. If dry-run → mark as filled immediately (simulated)
 * 4. If live → call adapter.placeOrder() → update DB
 */
export async function executeTrade(
  adapter: TradingPlatformAdapter,
  input: TradeExecutionInput
): Promise<ExecuteTradeResult> {
  const config = getConfig();
  const supabase = createServerClient();

  // ─── Safety checks ───

  // 1. Check for duplicate active order
  const alreadyActive = await hasActiveOrder(input.run_id);
  if (alreadyActive) {
    return {
      order: {} as TradeOrder,
      dryRun: config.dryRun,
      skipped: true,
      skipReason: "Active order already exists for this run",
    };
  }

  // 2. Max single position size
  if (input.size_usd > config.maxPositionUsd) {
    input = { ...input, size_usd: config.maxPositionUsd };
  }

  // 3. Total exposure check (live only)
  if (!config.dryRun) {
    const currentExposure = await getTotalOpenExposure();
    if (currentExposure + input.size_usd > config.maxTotalExposureUsd) {
      return {
        order: {} as TradeOrder,
        dryRun: false,
        skipped: true,
        skipReason: `Total exposure would exceed limit: $${currentExposure} + $${input.size_usd} > $${config.maxTotalExposureUsd}`,
      };
    }
  }

  // 4. Minimum edge check
  if (Math.abs(input.edge) < 0.01) {
    return {
      order: {} as TradeOrder,
      dryRun: config.dryRun,
      skipped: true,
      skipReason: `Edge too small: ${(input.edge * 100).toFixed(1)}%`,
    };
  }

  // ─── Insert pending order to DB ───

  const size = input.size_usd / input.price;

  const orderRow = {
    platform: input.platform,
    run_id: input.run_id,
    batch_id: input.batch_id,
    market_id: input.market_id,
    token_id: input.token_id,
    side: "BUY",
    outcome: input.outcome,
    order_type: input.order_type,
    price: input.price,
    size,
    size_usd: input.size_usd,
    status: "pending" as const,
    dry_run: config.dryRun,
    edge_at_placement: input.edge,
    model_prob_at_placement: input.model_prob,
    market_price_at_placement: input.market_price,
  };

  const { data: insertedOrder, error: insertError } = await supabase
    .from("trade_orders")
    .insert(orderRow)
    .select()
    .single();

  if (insertError || !insertedOrder) {
    throw new Error(
      `Failed to insert order: ${insertError?.message || "Unknown error"}`
    );
  }

  // ─── Execute or simulate ───

  if (config.dryRun) {
    // Dry-run: simulate fill
    const { data: updated } = await supabase
      .from("trade_orders")
      .update({
        status: "filled",
        fill_price: input.price,
        fill_size: size,
        fill_size_usd: input.size_usd,
        submitted_at: new Date().toISOString(),
        filled_at: new Date().toISOString(),
      })
      .eq("id", insertedOrder.id)
      .select()
      .single();

    return {
      order: (updated || insertedOrder) as TradeOrder,
      dryRun: true,
      skipped: false,
    };
  }

  // Live execution
  try {
    await adapter.initialize();

    const result = await adapter.placeOrder(input);

    const { data: updated } = await supabase
      .from("trade_orders")
      .update({
        external_order_id: result.externalOrderId,
        status: result.status,
        submitted_at: new Date().toISOString(),
        platform_response: result.raw,
      })
      .eq("id", insertedOrder.id)
      .select()
      .single();

    return {
      order: (updated || insertedOrder) as TradeOrder,
      dryRun: false,
      skipped: false,
    };
  } catch (err) {
    // Mark as failed
    await supabase
      .from("trade_orders")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq("id", insertedOrder.id);

    throw err;
  }
}

/**
 * Poll and update status for open orders
 */
export async function pollOpenOrders(
  adapter: TradingPlatformAdapter
): Promise<{ updated: number; errors: number }> {
  const supabase = createServerClient();
  const { data: openOrders } = await supabase
    .from("trade_orders")
    .select("*")
    .in("status", ["submitted", "live", "matched"])
    .eq("dry_run", false);

  if (!openOrders || openOrders.length === 0) {
    return { updated: 0, errors: 0 };
  }

  await adapter.initialize();
  let updated = 0;
  let errors = 0;

  for (const order of openOrders) {
    if (!order.external_order_id) continue;

    try {
      const status = await adapter.getOrderStatus(order.external_order_id);

      const updateData: Record<string, unknown> = { status: status.status };

      if (status.status === "filled") {
        updateData.fill_price = status.fillPrice;
        updateData.fill_size = status.fillSize;
        updateData.fill_size_usd = status.fillSize
          ? (status.fillPrice || order.price) * status.fillSize
          : null;
        updateData.filled_at = new Date().toISOString();
      } else if (
        status.status === "cancelled" ||
        status.status === "expired"
      ) {
        updateData.cancelled_at = new Date().toISOString();
      }

      await supabase
        .from("trade_orders")
        .update(updateData)
        .eq("id", order.id);

      updated++;
    } catch {
      errors++;
    }
  }

  return { updated, errors };
}
