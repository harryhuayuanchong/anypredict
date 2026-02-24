import { notFound } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WeatherStrategyRun, TradePlan, ForecastSnapshot } from "@/lib/types";
import { RefreshBatchButton } from "./refresh-button";
import { TradeControls, TradeButton } from "./trade-controls";

export const dynamic = "force-dynamic";

export default async function BatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const supabase = createServerClient();
  const { data: rawRuns, error } = await supabase
    .from("weather_strategy_runs")
    .select("*")
    .eq("batch_id", batchId)
    .order("edge", { ascending: true });

  if (error || !rawRuns || rawRuns.length === 0) {
    notFound();
  }

  const runs = rawRuns as WeatherStrategyRun[];

  // Derive event-level info from first run
  const firstRun = runs[0];
  const eventTitle = firstRun.market_title.split(" — ")[0];
  const location = firstRun.location_text;
  const resolutionTime = firstRun.resolution_time;

  // Categorize
  const buyNoRuns = runs
    .filter((r) => r.recommendation === "BUY_NO")
    .sort((a, b) => (a.edge ?? 0) - (b.edge ?? 0));
  const buyYesRuns = runs
    .filter((r) => r.recommendation === "BUY_YES")
    .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  const noTradeRuns = runs.filter((r) => r.recommendation === "NO_TRADE");

  // Sort all runs for table: tradeable first (by absolute edge desc), then no-trade
  const sortedRuns = [
    ...buyNoRuns,
    ...buyYesRuns,
    ...noTradeRuns,
  ];

  // Best picks
  const bestNo = buyNoRuns.length > 0 ? buyNoRuns[0] : null;
  const bestYes = buyYesRuns.length > 0 ? buyYesRuns[0] : null;

  // Get shared ensemble info from first run's forecast
  const forecast = firstRun.forecast_snapshot as ForecastSnapshot | null;

  // Data age calculation
  const createdAt = new Date(firstRun.created_at);
  const ageMinutes = Math.floor((Date.now() - createdAt.getTime()) / 60000);
  const isStale = ageMinutes > 5;

  // Helper to build a clear threshold label from run data
  function getThresholdLabel(run: WeatherStrategyRun): string {
    const lowC = run.threshold_low;
    const highC = run.threshold_high;

    // Convert °C to °F for display (Polymarket uses °F)
    const cToF = (c: number) => Math.round(c * 9 / 5 + 32);

    if (run.rule_type === "range" && lowC != null && highC != null) {
      return `${cToF(lowC)}–${cToF(highC)} °F`;
    }
    if (lowC != null && highC == null) {
      return `≥ ${cToF(lowC)} °F`;
    }
    if (highC != null && lowC == null) {
      return `≤ ${cToF(highC)} °F`;
    }
    if (lowC != null && highC != null) {
      // above_below with both — use whichever makes sense
      return `${cToF(lowC)}–${cToF(highC)} °F`;
    }
    // Fallback: extract from title
    const parts = run.market_title.split(" — ");
    return parts.length > 1 ? parts.slice(1).join(" — ") : run.market_title;
  }

  // Shorter fallback from title
  function getMarketLabel(run: WeatherStrategyRun): string {
    const parts = run.market_title.split(" — ");
    return parts.length > 1 ? parts.slice(1).join(" — ") : run.market_title;
  }

  // Helper for recommendation badge
  function RecBadge({ rec }: { rec: string | null }) {
    if (rec === "BUY_YES")
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
          BUY YES
        </Badge>
      );
    if (rec === "BUY_NO")
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0">
          BUY NO
        </Badge>
      );
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        NO TRADE
      </Badge>
    );
  }

  // Edge strength label
  function edgeLabel(edge: number | null): string {
    if (edge == null) return "";
    const abs = Math.abs(edge);
    if (abs > 0.15) return "Strong";
    if (abs > 0.08) return "Moderate";
    if (abs > 0.03) return "Weak";
    return "Negligible";
  }

  // ═══ Trader's Verdict — quick instinct decision ═══
  const tradeableCount = buyNoRuns.length + buyYesRuns.length;
  const bestPick = bestNo
    ? bestNo
    : bestYes
    ? bestYes
    : null;
  const bestPickSide = bestNo ? "NO" : bestYes ? "YES" : null;

  // Compute conviction for the best pick
  function computeConviction(run: WeatherStrategyRun | null): number {
    if (!run) return 0;
    const tp2 = run.trade_plan as TradePlan | null;
    const absE = Math.abs(run.edge ?? 0) * 100;
    const eScore = Math.min(absE / 20, 1);
    const kScore = Math.min((tp2?.kelly_fraction ?? 0) / 0.15, 1);
    const fs = run.forecast_snapshot as ForecastSnapshot | null;
    const aScore = fs?.models_agree == null ? 0.7 : fs.models_agree ? 1 : 0.3;
    const sScore = Math.max(0, 1 - (fs?.ensemble_std ?? 3) / 5);
    const pBonus = fs?.prob_method === "ensemble" ? 1 : 0.6;
    return Math.round(
      Math.min(eScore * 0.35 + kScore * 0.20 + aScore * 0.15 + sScore * 0.15 + pBonus * 0.15, 1) * 100
    );
  }

  const bestConviction = computeConviction(bestPick);
  const bestConvictionLabel = bestConviction >= 75 ? "High" : bestConviction >= 45 ? "Medium" : bestConviction >= 20 ? "Low" : "None";
  const bestConvictionColor = bestConviction >= 75
    ? "text-emerald-600 dark:text-emerald-400"
    : bestConviction >= 45
    ? "text-amber-600 dark:text-amber-400"
    : "text-red-500 dark:text-red-400";
  const bestConvictionBarColor = bestConviction >= 75
    ? "bg-emerald-500"
    : bestConviction >= 45
    ? "bg-amber-500"
    : "bg-red-500";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/runs"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← All Runs
          </Link>
          <h1 className="text-2xl font-bold mt-1">{eventTitle}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
            <span>{location}</span>
            <span>•</span>
            <span>
              Resolves{" "}
              {new Date(resolutionTime).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span>•</span>
            <Badge variant="outline" className="text-xs">
              {runs.length} markets
            </Badge>
          </div>
          {/* Data freshness */}
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`text-xs ${
                isStale
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              }`}
            >
              {isStale ? "⚠ " : ""}
              Prices as of{" "}
              {createdAt.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
              {ageMinutes > 0 && ` (${ageMinutes}m ago)`}
            </span>
            <RefreshBatchButton batchId={batchId} />
          </div>
        </div>
        <Link href="/new">
          <Button variant="outline" size="sm">
            New Analysis
          </Button>
        </Link>
      </div>

      {/* ═══ Trader's Verdict ═══ */}
      <Card className={`border-2 ${
        bestPick
          ? bestPickSide === "NO"
            ? "border-red-200 bg-red-50/30 dark:border-red-900/50 dark:bg-red-950/10"
            : "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/50 dark:bg-emerald-950/10"
          : "border-muted bg-muted/30"
      }`}>
        <CardContent className="pt-5 pb-5 space-y-3">
          {bestPick ? (
            <>
              <div className="flex items-start gap-3">
                <div className="text-2xl mt-0.5">
                  {bestPickSide === "NO" ? "🔴" : "🟢"}
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Best Play</p>
                  <p className={`text-lg font-bold ${
                    bestPickSide === "NO"
                      ? "text-red-700 dark:text-red-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  }`}>
                    Buy {bestPickSide} on {getThresholdLabel(bestPick)} at {
                      bestPickSide === "NO"
                        ? ((bestPick.no_price ?? 0) * 100).toFixed(0)
                        : ((bestPick.yes_price ?? 0) * 100).toFixed(0)
                    }¢ for ${(bestPick.trade_plan as TradePlan)?.suggested_size_usd?.toFixed(2) ?? "0"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Model gives {((bestPick.model_prob ?? 0) * 100).toFixed(1)}% probability YES
                    {" "}vs market&apos;s {((bestPick.market_implied_prob ?? 0) * 100).toFixed(1)}%
                    {" "}— {Math.abs((bestPick.edge ?? 0) * 100).toFixed(1)}% edge ({edgeLabel(bestPick.edge)})
                  </p>
                </div>
              </div>

              {/* Conviction meter */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground uppercase tracking-wide shrink-0 w-16">Conviction</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${bestConvictionBarColor}`}
                    style={{ width: `${bestConviction}%` }}
                  />
                </div>
                <span className={`text-xs font-bold font-mono shrink-0 ${bestConvictionColor}`}>
                  {bestConviction}% {bestConvictionLabel}
                </span>
              </div>

              {/* Quick stats */}
              <div className="flex gap-4 text-xs text-muted-foreground pt-1">
                <span>{tradeableCount} of {runs.length} markets tradeable</span>
                <span>•</span>
                <span>{buyNoRuns.length} BUY NO · {buyYesRuns.length} BUY YES · {noTradeRuns.length} skip</span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <div className="text-2xl">⏸</div>
              <div>
                <p className="font-semibold text-muted-foreground">No actionable trades</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  All {runs.length} markets are within the minimum edge threshold — sit this one out.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Trading Controls ═══ */}
      <TradeControls
        batchId={batchId}
        runIds={sortedRuns.map((r) => r.id)}
      />

      {/* Best Opportunity Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {bestNo && (
          <Link href={`/runs/${bestNo.id}`}>
            <Card className="border-red-200 dark:border-red-900/50 hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="text-red-500">★</span> Best NO Opportunity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono font-bold text-base">
                  {getThresholdLabel(bestNo)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {getMarketLabel(bestNo)}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-2xl font-mono font-bold text-red-600 dark:text-red-400">
                    {((bestNo.edge ?? 0) * 100).toFixed(1)}%
                  </span>
                  <div className="text-xs text-muted-foreground">
                    <p>
                      Edge ({edgeLabel(bestNo.edge)})
                    </p>
                    <p>
                      NO @ {((bestNo.no_price ?? 0) * 100).toFixed(0)}¢ →
                      Kelly ${(bestNo.trade_plan as TradePlan)?.suggested_size_usd?.toFixed(2) ?? "0"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {bestYes && (
          <Link href={`/runs/${bestYes.id}`}>
            <Card className="border-emerald-200 dark:border-emerald-900/50 hover:shadow-md transition-shadow cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="text-emerald-500">★</span> Best YES
                  Opportunity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-mono font-bold text-base">
                  {getThresholdLabel(bestYes)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {getMarketLabel(bestYes)}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-2xl font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    +{((bestYes.edge ?? 0) * 100).toFixed(1)}%
                  </span>
                  <div className="text-xs text-muted-foreground">
                    <p>
                      Edge ({edgeLabel(bestYes.edge)})
                    </p>
                    <p>
                      YES @ {((bestYes.yes_price ?? 0) * 100).toFixed(0)}¢ →
                      Kelly ${(bestYes.trade_plan as TradePlan)?.suggested_size_usd?.toFixed(2) ?? "0"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {!bestNo && !bestYes && (
          <Card className="sm:col-span-2 border-muted">
            <CardContent className="py-8 text-center text-muted-foreground">
              No tradeable opportunities found — all markets within min edge
              threshold.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-mono font-bold text-red-600 dark:text-red-400">
              {buyNoRuns.length}
            </p>
            <p className="text-xs text-muted-foreground">BUY NO signals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-mono font-bold text-emerald-600 dark:text-emerald-400">
              {buyYesRuns.length}
            </p>
            <p className="text-xs text-muted-foreground">BUY YES signals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-mono font-bold text-muted-foreground">
              {noTradeRuns.length}
            </p>
            <p className="text-xs text-muted-foreground">No Trade</p>
          </CardContent>
        </Card>
      </div>

      {/* Shared Ensemble Info */}
      {forecast?.ensemble_model && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Shared Forecast Data
              <Badge variant="outline" className="text-xs font-normal">
                {forecast.ensemble_model}
              </Badge>
              <Badge variant="outline" className="text-xs font-normal">
                {forecast.ensemble_member_count} members
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Forecast Temp:</span>{" "}
                <span className="font-mono font-medium">
                  {forecast.forecast_temp?.toFixed(1)}°C
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">P10:</span>{" "}
                <span className="font-mono">
                  {forecast.ensemble_p10?.toFixed(1)}°C
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">P50:</span>{" "}
                <span className="font-mono font-medium">
                  {forecast.ensemble_p50?.toFixed(1)}°C
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">P90:</span>{" "}
                <span className="font-mono">
                  {forecast.ensemble_p90?.toFixed(1)}°C
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">σ:</span>{" "}
                <span className="font-mono">
                  {forecast.ensemble_std?.toFixed(2)}°C
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Markets Comparison</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Market</TableHead>
                <TableHead className="text-right">YES¢</TableHead>
                <TableHead className="text-right">NO¢</TableHead>
                <TableHead className="text-right">Model Prob</TableHead>
                <TableHead className="text-right">Market Prob</TableHead>
                <TableHead className="text-right">Edge</TableHead>
                <TableHead className="text-center">Signal</TableHead>
                <TableHead className="text-right">Kelly Size</TableHead>
                <TableHead className="text-center">Trade</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRuns.map((run) => {
                const tp = run.trade_plan as TradePlan | null;
                const edge = run.edge ?? 0;
                const isNo = run.recommendation === "BUY_NO";
                const isYes = run.recommendation === "BUY_YES";

                return (
                  <TableRow
                    key={run.id}
                    className={
                      isNo
                        ? "bg-red-50/50 dark:bg-red-950/10"
                        : isYes
                        ? "bg-emerald-50/50 dark:bg-emerald-950/10"
                        : ""
                    }
                  >
                    <TableCell className="font-medium text-sm">
                      <div className="flex flex-col" title={run.market_title}>
                        <span className="font-mono font-semibold">
                          {getThresholdLabel(run)}
                        </span>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {getMarketLabel(run)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {(run.yes_price * 100).toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {(run.no_price * 100).toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {((run.model_prob ?? 0) * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {((run.market_implied_prob ?? 0) * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm font-bold ${
                        edge > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : edge < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {edge > 0 ? "+" : ""}
                      {(edge * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-center">
                      <RecBadge rec={run.recommendation} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {tp?.suggested_size_usd
                        ? `$${tp.suggested_size_usd.toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {(isNo || isYes) ? (
                        <TradeButton runId={run.id} batchId={batchId} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/runs/${run.id}`}>
                        <Button variant="ghost" size="sm" className="text-xs">
                          Details →
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Footer nav */}
      <div className="flex justify-between">
        <Link href="/runs">
          <Button variant="outline">← All Runs</Button>
        </Link>
        <Link href="/new">
          <Button>New Analysis</Button>
        </Link>
      </div>
    </div>
  );
}
