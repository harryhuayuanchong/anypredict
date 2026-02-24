import { NextRequest, NextResponse } from "next/server";
import { runStrategyBacktest } from "@/lib/backtest-engine";
import type { BacktestConfig } from "@/lib/backtest-engine";
import type { BacktestOutput } from "@/lib/types";

// Vercel Pro: up to 300s. Hobby: 10s (too short).
// Local dev / self-hosted: no timeout.
export const maxDuration = 60;

// In-memory cache keyed by config string (survives across requests in the same server process)
const cache = new Map<string, { result: BacktestOutput; time: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function parseConfig(params: URLSearchParams): BacktestConfig {
  const config: BacktestConfig = {};
  const start = params.get("start");
  const end = params.get("end");
  const feeBps = params.get("feeBps");
  const slippageBps = params.get("slippageBps");
  const baseSizeUsd = params.get("baseSizeUsd");
  const confidence = params.get("confidence");

  if (start) config.start = start;
  if (end) config.end = end;
  if (feeBps) config.feeBps = parseInt(feeBps, 10);
  if (slippageBps) config.slippageBps = parseInt(slippageBps, 10);
  if (baseSizeUsd) config.baseSizeUsd = parseInt(baseSizeUsd, 10);
  if (confidence) config.confidence = parseInt(confidence, 10);

  return config;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const fresh = params.get("fresh") === "1";
    const config = parseConfig(params);
    const cacheKey = JSON.stringify(config);

    if (!fresh) {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
        return NextResponse.json(cached.result);
      }
    }

    const result = await runStrategyBacktest(config);
    cache.set(cacheKey, { result, time: Date.now() });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Strategy backtest error:", err);
    return NextResponse.json(
      { error: `Backtest failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
