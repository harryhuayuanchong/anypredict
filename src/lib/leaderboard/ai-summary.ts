import { createHash } from "crypto";
import type { AiSummary, SummaryPayload } from "./types";

export function hashPayload(payload: SummaryPayload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildRuleBasedSummary(payload: SummaryPayload): AiSummary {
  const pnlText =
    payload.realizedPnl >= 0
      ? `Wallet realized ${usd(payload.realizedPnl)} in closed-position PnL.`
      : `Wallet realized ${usd(payload.realizedPnl)} loss in closed-position PnL.`;

  const roiProxy =
    payload.lifetimeVolume > 0
      ? `${((payload.realizedPnl / payload.lifetimeVolume) * 100).toFixed(2)}%`
      : "N/A";

  const holdingText = `Currently holding ${payload.openPositions} open positions with ${usd(
    payload.openPositionsValue
  )} total value. Largest exposure is ${
    payload.topPositionTitle || "Uncategorized market"
  } at ${usd(payload.topPositionValue)}.`;

  const tradeText = `Analyzed ${payload.trades} recent trades (${payload.buys} buys / ${payload.sells} sells). ${
    payload.winRate === null ? "Win rate unavailable." : `Closed-position win rate is ${payload.winRate.toFixed(2)}%.`
  }`;

  const categoryText = `Most exposed category appears to be ${
    payload.categoryHint || "Uncategorized"
  }. Use this as directional context, not financial advice.`;

  return {
    performanceSnapshot: `${pnlText} PnL-to-volume ratio proxy: ${roiProxy}.`,
    holdingBehavior: holdingText,
    tradePattern: tradeText,
    categoryEdge: categoryText,
  };
}

export function parseSummaryResponse(content: string): AiSummary | null {
  try {
    const parsed = JSON.parse(content);
    if (
      typeof parsed?.performanceSnapshot === "string" &&
      typeof parsed?.holdingBehavior === "string" &&
      typeof parsed?.tradePattern === "string" &&
      typeof parsed?.categoryEdge === "string"
    ) {
      return parsed as AiSummary;
    }
    return null;
  } catch {
    return null;
  }
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
