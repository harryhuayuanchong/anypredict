import Link from "next/link";
import { createServerClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { WeatherStrategyRun } from "@/lib/types";
import { RunsCharts } from "./runs-charts";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const supabase = createServerClient();
  const { data: runs, error } = await supabase
    .from("weather_strategy_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Strategy Runs</h1>
        <div className="rounded-md bg-destructive/10 p-4 text-destructive">
          Database error: {error.message}. Make sure you&apos;ve run the
          migration and set env vars.
        </div>
      </div>
    );
  }

  const typedRuns = (runs ?? []) as WeatherStrategyRun[];

  // Aggregate stats from backtested runs
  const backtested = typedRuns.filter((r) => r.backtested_at != null);
  const traded = backtested.filter((r) => r.recommendation !== "NO_TRADE");
  const wins = traded.filter((r) => r.pnl != null && r.pnl > 0);
  const totalPnl = traded.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  const avgEdge =
    traded.length > 0
      ? traded.reduce((sum, r) => sum + (r.edge ?? 0), 0) / traded.length
      : 0;
  // Strategy performance metrics
  const pnls = traded.map((r) => r.pnl ?? 0);

  // Sharpe Ratio (annualized, assuming ~1 trade/day)
  const meanPnl = pnls.length > 0 ? pnls.reduce((s, v) => s + v, 0) / pnls.length : 0;
  const pnlStd =
    pnls.length > 1
      ? Math.sqrt(
          pnls.reduce((s, v) => s + (v - meanPnl) ** 2, 0) / (pnls.length - 1)
        )
      : 0;
  const sharpeRatio = pnlStd > 0 ? (meanPnl / pnlStd) * Math.sqrt(252) : 0;

  // Max Drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let cumPnl = 0;
  for (const pnl of pnls) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const badgeVariant = (rec: string | null) => {
    if (rec === "BUY_YES") return "default" as const;
    if (rec === "BUY_NO") return "secondary" as const;
    return "outline" as const;
  };

  // Data for charts (chronological order)
  const chartRuns = backtested
    .filter((r) => r.recommendation !== "NO_TRADE")
    .reverse()
    .map((r) => ({
      id: r.id,
      title: r.market_title,
      pnl: r.pnl ?? 0,
      date: new Date(r.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      model_prob: r.model_prob ?? 0,
      market_prob: r.market_implied_prob ?? 0,
      resolved_yes: r.resolved_yes ?? false,
    }));

  // Forecast error distribution
  const errorBuckets = [
    { range: "0-1°C", count: 0 },
    { range: "1-2°C", count: 0 },
    { range: "2-3°C", count: 0 },
    { range: "3-5°C", count: 0 },
    { range: "5+°C", count: 0 },
  ];
  backtested.forEach((r) => {
    const fc = r.forecast_snapshot?.forecast_temp;
    const ac = r.actual_temp;
    if (fc != null && ac != null) {
      const err = Math.abs(ac - fc);
      if (err <= 1) errorBuckets[0].count++;
      else if (err <= 2) errorBuckets[1].count++;
      else if (err <= 3) errorBuckets[2].count++;
      else if (err <= 5) errorBuckets[3].count++;
      else errorBuckets[4].count++;
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analysis Runs</h1>
        <Link href="/new">
          <Button>+ New Analysis</Button>
        </Link>
      </div>

      {/* Performance Dashboard */}
      {backtested.length > 0 && (
        <>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex flex-col sm:flex-row gap-6">
                {/* Hero: Total P&L */}
                <div className="flex-1 flex items-center gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total P&amp;L</p>
                    <p
                      className={`text-4xl font-black font-mono tracking-tight ${
                        totalPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-medium">
                        {traded.length > 0
                          ? `${((wins.length / traded.length) * 100).toFixed(0)}% win rate`
                          : "No trades"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {wins.length}W &middot; {traded.length - wins.length}L across {traded.length} trades
                      </span>
                    </div>
                  </div>
                </div>

                {/* Secondary metrics */}
                <div className="grid grid-cols-3 gap-4 sm:gap-6">
                  {/* Sharpe */}
                  <div className="text-center sm:text-right">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sharpe</p>
                    <p className={`text-2xl font-bold font-mono ${sharpeRatio >= 1 ? "text-emerald-600 dark:text-emerald-400" : sharpeRatio >= 0 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                      {traded.length >= 2 ? sharpeRatio.toFixed(1) : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">annualized</p>
                  </div>

                  {/* Max DD */}
                  <div className="text-center sm:text-right">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Max DD</p>
                    <p className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">
                      {maxDrawdown > 0 ? `-$${maxDrawdown.toFixed(2)}` : "$0"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">drawdown</p>
                  </div>

                  {/* Avg Edge */}
                  <div className="text-center sm:text-right">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Avg Edge</p>
                    <p className="text-2xl font-bold font-mono">
                      {(avgEdge * 100).toFixed(1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">per trade</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Charts */}
          <RunsCharts
            pnlRuns={chartRuns}
            errorBuckets={errorBuckets}
          />
        </>
      )}

      {/* Runs list — grouped by batch */}
      {typedRuns.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          <p>No runs yet. Create your first event analysis to get started.</p>
          <Link href="/new">
            <Button className="mt-4">Analyze Event</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {(() => {
            // Group runs: batch runs grouped together, individual runs standalone
            const groups: { key: string; batchId: string | null; runs: WeatherStrategyRun[] }[] = [];
            const seen = new Set<string>();

            for (const run of typedRuns) {
              if (run.batch_id) {
                if (seen.has(run.batch_id)) continue;
                seen.add(run.batch_id);
                const batchRuns = typedRuns.filter((r) => r.batch_id === run.batch_id);
                groups.push({ key: run.batch_id, batchId: run.batch_id, runs: batchRuns });
              } else {
                groups.push({ key: run.id, batchId: null, runs: [run] });
              }
            }

            return groups.map((group) => {
              // Batch group
              if (group.batchId && group.runs.length > 1) {
                const eventTitle = group.runs[0].market_title.split(" — ")[0];
                const tradeable = group.runs.filter((r) => r.recommendation !== "NO_TRADE");
                const bestEdge = tradeable.length > 0
                  ? tradeable.reduce((best, r) =>
                      Math.abs(r.edge ?? 0) > Math.abs(best.edge ?? 0) ? r : best
                    )
                  : null;

                return (
                  <Link
                    key={group.key}
                    href={`/runs/batch/${group.batchId}`}
                    className="block rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs shrink-0">
                            {group.runs.length} markets
                          </Badge>
                          <p className="font-medium truncate">{eventTitle}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {group.runs[0].location_text} &middot;{" "}
                          {new Date(group.runs[0].resolution_time).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {tradeable.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {tradeable.length} tradeable
                          </span>
                        )}
                        {bestEdge && (
                          <>
                            <Badge variant={badgeVariant(bestEdge.recommendation)}>
                              {bestEdge.recommendation}
                            </Badge>
                            <span className="text-sm font-mono">
                              {bestEdge.edge != null
                                ? `${bestEdge.edge > 0 ? "+" : ""}${(bestEdge.edge * 100).toFixed(1)}%`
                                : "—"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Batch analysis &middot; {new Date(group.runs[0].created_at).toLocaleString()}
                    </p>
                  </Link>
                );
              }

              // Individual run
              const run = group.runs[0];
              return (
                <Link
                  key={group.key}
                  href={run.batch_id ? `/runs/batch/${run.batch_id}` : `/runs/${run.id}`}
                  className="block rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <p className="font-medium truncate">{run.market_title}</p>
                      <p className="text-sm text-muted-foreground">
                        {run.location_text} &middot;{" "}
                        {new Date(run.resolution_time).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {run.backtested_at && (
                        <span
                          className={`text-xs font-mono ${
                            run.pnl != null && run.pnl >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {run.pnl != null && run.pnl >= 0 ? "+" : ""}$
                          {run.pnl?.toFixed(2)}
                        </span>
                      )}
                      <Badge variant={badgeVariant(run.recommendation)}>
                        {run.recommendation ?? "—"}
                      </Badge>
                      <span className="text-sm font-mono">
                        {run.edge != null
                          ? `${(run.edge * 100).toFixed(1)}%`
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(run.created_at).toLocaleString()}
                    {run.backtested_at && (
                      <span className="ml-2">
                        &middot; Backtested &middot;{" "}
                        {run.resolved_yes ? "Resolved YES" : "Resolved NO"}
                      </span>
                    )}
                  </p>
                </Link>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
