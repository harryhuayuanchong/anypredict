/* ═══════════════════════════════════════════════════════
   Auto-Trader
   Evaluates batches and executes trades automatically
   based on edge, conviction, and model agreement
   ═══════════════════════════════════════════════════════ */

import { createServerClient } from "@/lib/supabase";
import type { WeatherStrategyRun } from "@/lib/types";
import type { TradingPlatformAdapter, OrderOutcome } from "./types";
import { executeTrade, type ExecuteTradeResult } from "./executor";

interface AutoTradeConfig {
  enabled: boolean;
  minEdge: number;
  minConviction: number;
  requireModelsAgree: boolean;
}

function getAutoTradeConfig(): AutoTradeConfig {
  return {
    enabled: process.env.POLYMARKET_AUTO_TRADE === "true",
    minEdge: parseFloat(process.env.POLYMARKET_AUTO_MIN_EDGE || "0.05"),
    minConviction: parseInt(
      process.env.POLYMARKET_AUTO_MIN_CONVICTION || "45"
    ),
    requireModelsAgree:
      process.env.POLYMARKET_AUTO_MODELS_AGREE !== "false",
  };
}

export interface AutoTradeAction {
  run_id: string;
  market_title: string;
  action: "executed" | "skipped";
  reason: string;
  result?: ExecuteTradeResult;
}

/**
 * Evaluate and auto-execute trades for all runs in a batch
 */
export async function evaluateBatch(
  adapter: TradingPlatformAdapter,
  batchId: string
): Promise<AutoTradeAction[]> {
  const config = getAutoTradeConfig();
  const supabase = createServerClient();

  // Fetch all runs in the batch
  const { data: runs, error } = await supabase
    .from("weather_strategy_runs")
    .select("*")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  if (error || !runs) {
    throw new Error(`Failed to fetch batch runs: ${error?.message}`);
  }

  const actions: AutoTradeAction[] = [];

  for (const run of runs as WeatherStrategyRun[]) {
    const action = await evaluateRun(adapter, run, config);
    actions.push(action);
  }

  return actions;
}

/**
 * Evaluate a single run for auto-trading
 */
async function evaluateRun(
  adapter: TradingPlatformAdapter,
  run: WeatherStrategyRun,
  config: AutoTradeConfig
): Promise<AutoTradeAction> {
  const base = {
    run_id: run.id,
    market_title: run.market_title,
  };

  // 1. Check recommendation — skip NO_TRADE
  if (!run.recommendation || run.recommendation === "NO_TRADE") {
    return {
      ...base,
      action: "skipped",
      reason: `No trade signal (recommendation: ${run.recommendation || "null"})`,
    };
  }

  // 2. Check token IDs exist
  if (!run.clob_token_id_yes && !run.clob_token_id_no) {
    return {
      ...base,
      action: "skipped",
      reason: "Missing CLOB token IDs — cannot execute trade",
    };
  }

  // 3. Check edge meets minimum
  const edge = Math.abs(run.edge || 0);
  if (edge < config.minEdge) {
    return {
      ...base,
      action: "skipped",
      reason: `Edge too small: ${(edge * 100).toFixed(1)}% < ${(config.minEdge * 100).toFixed(1)}%`,
    };
  }

  // 4. Check conviction (user_confidence)
  if (run.user_confidence < config.minConviction) {
    return {
      ...base,
      action: "skipped",
      reason: `Conviction too low: ${run.user_confidence} < ${config.minConviction}`,
    };
  }

  // 5. Check models agree (if required)
  if (config.requireModelsAgree) {
    const modelsAgree = run.forecast_snapshot?.models_agree;
    if (modelsAgree === false) {
      return {
        ...base,
        action: "skipped",
        reason: "Models disagree on direction",
      };
    }
  }

  // 6. Determine outcome and token ID
  const outcome: OrderOutcome =
    run.recommendation === "BUY_YES" ? "YES" : "NO";

  const tokenId =
    outcome === "YES"
      ? run.clob_token_id_yes
      : run.clob_token_id_no;

  if (!tokenId) {
    return {
      ...base,
      action: "skipped",
      reason: `Missing ${outcome} token ID`,
    };
  }

  // 7. Calculate trade price
  const price =
    outcome === "YES" ? run.yes_price : run.no_price;

  // 8. Calculate size from trade plan
  const sizeUsd =
    run.trade_plan?.half_kelly_size_usd ||
    run.trade_plan?.suggested_size_usd ||
    0;

  if (sizeUsd <= 0) {
    return {
      ...base,
      action: "skipped",
      reason: "No suggested size (Kelly = 0)",
    };
  }

  // 9. Execute!
  try {
    const result = await executeTrade(adapter, {
      run_id: run.id,
      batch_id: run.batch_id,
      platform: adapter.platform,
      market_id: run.condition_id || run.id,
      token_id: tokenId,
      outcome,
      price,
      size_usd: sizeUsd,
      order_type: "GTC",
      neg_risk: run.neg_risk,
      tick_size: "0.01",
      edge: run.edge || 0,
      model_prob: run.model_prob || 0,
      market_price: price,
    });

    if (result.skipped) {
      return {
        ...base,
        action: "skipped",
        reason: result.skipReason || "Skipped by executor",
      };
    }

    return {
      ...base,
      action: "executed",
      reason: `${outcome} @ ${(price * 100).toFixed(0)}¢ — $${sizeUsd.toFixed(2)} (${result.dryRun ? "dry-run" : "live"})`,
      result,
    };
  } catch (err) {
    return {
      ...base,
      action: "skipped",
      reason: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Cancel all open orders for a batch
 */
export async function cancelBatchOrders(
  adapter: TradingPlatformAdapter,
  batchId: string
): Promise<{ cancelled: number; errors: number }> {
  const supabase = createServerClient();
  const { data: orders } = await supabase
    .from("trade_orders")
    .select("*")
    .eq("batch_id", batchId)
    .in("status", ["submitted", "live", "matched"])
    .eq("dry_run", false);

  if (!orders || orders.length === 0) {
    return { cancelled: 0, errors: 0 };
  }

  await adapter.initialize();
  let cancelled = 0;
  let errors = 0;

  for (const order of orders) {
    if (!order.external_order_id) {
      // No external ID — just mark as cancelled in DB
      await supabase
        .from("trade_orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      cancelled++;
      continue;
    }

    try {
      const ok = await adapter.cancelOrder(order.external_order_id);
      if (ok) {
        await supabase
          .from("trade_orders")
          .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
          })
          .eq("id", order.id);
        cancelled++;
      } else {
        errors++;
      }
    } catch {
      errors++;
    }
  }

  return { cancelled, errors };
}
