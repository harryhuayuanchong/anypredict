import { notFound } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { WeatherStrategyRun, TradePlan } from "@/lib/types";
import { AiSummaryButton } from "./ai-summary-button";
import { AiSummaryContent } from "./ai-summary-content";
import { BacktestSection } from "./backtest-section";
import { ForecastChartSection } from "./forecast-chart-section";
import { TradeSection } from "./trade-section";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data: run, error } = await supabase
    .from("weather_strategy_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !run) {
    notFound();
  }

  const r = run as WeatherStrategyRun;
  const tp = r.trade_plan as TradePlan | null;

  // Derive display unit from weather_metric
  const METRIC_UNITS: Record<string, string> = {
    temperature: "°C",
    snowfall: "cm",
    rainfall: "mm",
    wind_speed: "km/h",
    earthquake_magnitude: "M",
    climate_anomaly: "°C",
  };
  const unit = METRIC_UNITS[r.weather_metric ?? "temperature"] ?? "°C";

  const isPast = new Date(r.resolution_time) < new Date();

  // Data age calculation
  const createdAt = new Date(r.created_at);
  const ageMinutes = Math.floor((Date.now() - createdAt.getTime()) / 60000);
  const isStale = ageMinutes > 5;

  const isYes = r.recommendation === "BUY_YES";
  const isNo = r.recommendation === "BUY_NO";
  const isNoTrade = r.recommendation === "NO_TRADE" || !r.recommendation;

  const recColor = isYes
    ? "text-green-600"
    : isNo
    ? "text-red-600"
    : "text-muted-foreground";

  const recBg = isYes
    ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900"
    : isNo
    ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900"
    : "bg-muted/50 border-border";

  const ruleDesc =
    r.rule_type === "above_below"
      ? r.threshold_low != null && r.threshold_high == null
        ? `≥ ${r.threshold_low} ${unit}`
        : `≤ ${r.threshold_high} ${unit}`
      : `${r.threshold_low}–${r.threshold_high} ${unit}`;

  // Edge strength label
  const absEdge = Math.abs(r.edge ?? 0) * 100;
  const edgeStrength =
    absEdge >= 15 ? "Strong" : absEdge >= 8 ? "Moderate" : absEdge >= 3 ? "Weak" : "Negligible";

  // ═══ Conviction score (0-100) from multiple signals ═══
  const edgeScore = Math.min(absEdge / 20, 1); // 20%+ edge = max
  const kellyScore = Math.min((tp?.kelly_fraction ?? 0) / 0.15, 1); // 15%+ Kelly = max
  const agreementScore = r.forecast_snapshot?.models_agree == null ? 0.7 : r.forecast_snapshot.models_agree ? 1 : 0.3;
  const ensembleStd = r.forecast_snapshot?.ensemble_std ?? 3;
  const spreadScore = Math.max(0, 1 - ensembleStd / 5); // tighter spread = higher
  const probMethodBonus = r.forecast_snapshot?.prob_method === "ensemble" ? 1 : 0.6;

  const rawConviction = isNoTrade
    ? 0
    : (edgeScore * 0.35 + kellyScore * 0.20 + agreementScore * 0.15 + spreadScore * 0.15 + probMethodBonus * 0.15);
  const conviction = Math.round(Math.min(rawConviction, 1) * 100);

  const convictionLabel = conviction >= 75 ? "High" : conviction >= 45 ? "Medium" : conviction >= 20 ? "Low" : "None";
  const convictionColor = conviction >= 75
    ? "text-emerald-600 dark:text-emerald-400"
    : conviction >= 45
    ? "text-amber-600 dark:text-amber-400"
    : "text-red-500 dark:text-red-400";
  const convictionBarColor = conviction >= 75
    ? "bg-emerald-500"
    : conviction >= 45
    ? "bg-amber-500"
    : "bg-red-500";

  // Action statement
  const actionText = isNoTrade
    ? "No trade — insufficient edge to justify a position"
    : isNo
    ? `Buy NO at ${(r.no_price * 100).toFixed(0)}¢ for $${tp?.suggested_size_usd?.toFixed(2) ?? "0"}`
    : `Buy YES at ${(r.yes_price * 100).toFixed(0)}¢ for $${tp?.suggested_size_usd?.toFixed(2) ?? "0"}`;

  // Quick reason (derived from data)
  const modelProbPct = ((r.model_prob ?? 0) * 100).toFixed(1);
  const marketProbPct = ((r.market_implied_prob ?? 0) * 100).toFixed(1);
  const quickReason = isNoTrade
    ? `Model probability (${modelProbPct}%) is close to market (${marketProbPct}%) — no mispricing detected.`
    : isNo
    ? `Model gives ${modelProbPct}% chance YES, but market prices ${marketProbPct}% — market is overpricing YES.`
    : `Model gives ${modelProbPct}% chance YES, but market only prices ${marketProbPct}% — market is underpricing YES.`;

  // Key risk
  const keyRisk = tp?.invalidated_if?.[0] ?? (
    isNoTrade
      ? "Edge could appear if prices shift significantly."
      : "Forecast model updates could narrow or reverse the edge."
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/runs"
              className="text-muted-foreground hover:text-foreground"
            >
              &larr; All Runs
            </Link>
            {r.batch_id && (
              <>
                <span className="text-muted-foreground">/</span>
                <Link
                  href={`/runs/batch/${r.batch_id}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Event Comparison
                </Link>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold mt-1">{r.market_title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-muted-foreground">
              {r.location_text}
            </span>
            <span className="text-muted-foreground">&#183;</span>
            <span className="text-sm text-muted-foreground">
              {new Date(r.resolution_time).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="text-muted-foreground">&#183;</span>
            <span className="text-sm text-muted-foreground">
              Created {new Date(r.created_at).toLocaleString()}
            </span>
          </div>
          {/* Data freshness warning */}
          {!isPast && (
            <div className="mt-1.5">
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
                {isStale && " — prices may have changed"}
              </span>
            </div>
          )}
        </div>
        {r.backtested_at && (
          <Badge
            variant={r.pnl != null && r.pnl >= 0 ? "default" : "destructive"}
            className="text-sm px-3 py-1"
          >
            {r.pnl != null && r.pnl >= 0 ? "WIN" : "LOSS"} ${r.pnl?.toFixed(2)}
          </Badge>
        )}
      </div>

      {/* ═══ Trade Decision Card ═══ */}
      <Card className={`border-2 ${recBg}`}>
        <CardContent className="pt-6 pb-6 space-y-4">
          {/* Top row: signal + edge + size */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`text-4xl font-black tracking-tight ${recColor}`}>
                {r.recommendation ?? "NO SIGNAL"}
              </div>
              {!isNoTrade && (
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Edge</span>
                  <span className={`text-2xl font-bold font-mono ${recColor}`}>
                    {r.edge != null ? `${r.edge > 0 ? "+" : ""}${(r.edge * 100).toFixed(2)}%` : "--"}
                  </span>
                  <Badge variant="outline" className="w-fit text-[10px] mt-0.5">
                    {edgeStrength}
                  </Badge>
                </div>
              )}
            </div>
            {!isNoTrade && tp && (
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide block">Size</span>
                  <span className="text-3xl font-bold font-mono">
                    ${tp.suggested_size_usd?.toFixed(2)}
                  </span>
                  {tp.kelly_fraction != null && tp.kelly_fraction > 0 && (
                    <span className="text-xs text-muted-foreground block">
                      Half-Kelly ({(tp.kelly_fraction * 100).toFixed(1)}% Kelly)
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <Separator />

          {/* Action statement */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className={`shrink-0 mt-0.5 text-lg ${isNoTrade ? "opacity-40" : ""}`}>
                {isNoTrade ? "⏸" : isNo ? "🔴" : "🟢"}
              </div>
              <div className="flex-1">
                <p className={`font-semibold text-base ${isNoTrade ? "text-muted-foreground" : ""}`}>
                  {actionText}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {quickReason}
                </p>
              </div>
            </div>

            {/* Conviction meter */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wide shrink-0 w-16">Conviction</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${convictionBarColor}`}
                  style={{ width: `${conviction}%` }}
                />
              </div>
              <span className={`text-xs font-bold font-mono shrink-0 ${convictionColor}`}>
                {conviction}% {convictionLabel}
              </span>
            </div>

            {/* Key risk */}
            {!isNoTrade && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 px-3 py-2">
                <span className="text-amber-500 shrink-0 text-xs mt-0.5">⚠</span>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  <span className="font-semibold">Key risk:</span> {keyRisk}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══ Signal Breakdown ═══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Model Prob */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model Prob</p>
                <p className="text-3xl font-bold font-mono mt-1">
                  {r.model_prob != null
                    ? `${(r.model_prob * 100).toFixed(1)}%`
                    : "--"}
                </p>
              </div>
              {r.forecast_snapshot?.prob_method && (
                <Badge
                  variant={r.forecast_snapshot.prob_method === "ensemble" ? "default" : "secondary"}
                  className="text-[10px] shrink-0"
                >
                  {r.forecast_snapshot.prob_method === "ensemble"
                    ? `${r.forecast_snapshot.ensemble_member_count} members`
                    : "Normal"}
                </Badge>
              )}
            </div>
            {r.forecast_snapshot?.prob_method === "ensemble" && (
              <p className="text-xs text-muted-foreground mt-1">
                via {(r.forecast_snapshot.ensemble_models?.length ?? 1) >= 2
                  ? `${r.forecast_snapshot.ensemble_models?.length} models`
                  : r.forecast_snapshot.ensemble_model} ensemble
              </p>
            )}
          </CardContent>
        </Card>

        {/* Market Implied */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Market Implied</p>
            <p className="text-3xl font-bold font-mono mt-1">
              {r.market_implied_prob != null
                ? `${(r.market_implied_prob * 100).toFixed(1)}%`
                : "--"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              YES {r.yes_price} / NO {r.no_price}
            </p>
          </CardContent>
        </Card>

        {/* Edge */}
        <Card className={r.edge != null && Math.abs(r.edge) > 0.05
          ? isYes ? "ring-1 ring-green-300 dark:ring-green-800" : isNo ? "ring-1 ring-red-300 dark:ring-red-800" : ""
          : ""}>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Edge</p>
            <p className={`text-3xl font-bold font-mono mt-1 ${recColor}`}>
              {r.edge != null ? `${r.edge > 0 ? "+" : ""}${(r.edge * 100).toFixed(2)}%` : "--"}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">
                after {r.fee_bps}bp fees + {r.slippage_bps}bp slip
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Kelly Sizing */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Position Sizing</p>
            <p className="text-3xl font-bold font-mono mt-1">
              ${tp?.suggested_size_usd?.toFixed(2) ?? "0"}
            </p>
            {tp?.kelly_fraction != null && tp.kelly_fraction > 0 ? (
              <div className="mt-1 space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Kelly:</span>
                  <span className="font-mono font-medium bg-muted px-1.5 py-0.5 rounded">
                    {(tp.kelly_fraction * 100).toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground">&#8594;</span>
                  <span className="font-mono">${tp.kelly_size_usd?.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Half-K:</span>
                  <span className="font-mono font-medium bg-muted px-1.5 py-0.5 rounded">
                    ${tp.half_kelly_size_usd?.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground">x {r.user_confidence}% conf</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                No edge — no position
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ Trade Execution ═══ */}
      <TradeSection runId={r.id} recommendation={r.recommendation} />

      {/* ═══ Multi-Model Ensemble ═══ */}
      {r.forecast_snapshot?.ensemble_members && r.forecast_snapshot.ensemble_members.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                Multi-Model Ensemble
                {r.forecast_snapshot.models_agree != null && (
                  <Badge
                    variant={r.forecast_snapshot.models_agree ? "default" : "destructive"}
                    className="text-[10px] font-normal"
                  >
                    {r.forecast_snapshot.models_agree ? "Models Agree" : "Models Disagree"}
                  </Badge>
                )}
              </CardTitle>
              <Badge variant="secondary" className="text-xs font-normal">
                {r.forecast_snapshot.ensemble_member_count} members &#183; {(r.forecast_snapshot.ensemble_models?.length ?? 1)} models
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Combined stats */}
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-center">
                <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">P10 (low)</p>
                <p className="font-mono text-xl font-bold mt-0.5">{r.forecast_snapshot.ensemble_p10} {unit}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3 text-center">
                <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">P50 (median)</p>
                <p className="font-mono text-xl font-bold mt-0.5">{r.forecast_snapshot.ensemble_p50} {unit}</p>
              </div>
              <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 p-3 text-center">
                <p className="text-[10px] font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wide">P90 (high)</p>
                <p className="font-mono text-xl font-bold mt-0.5">{r.forecast_snapshot.ensemble_p90} {unit}</p>
              </div>
              <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 p-3 text-center">
                <p className="text-[10px] font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide">Spread (&#963;)</p>
                <p className="font-mono text-xl font-bold mt-0.5">{r.forecast_snapshot.ensemble_std} {unit}</p>
              </div>
            </div>

            {/* Per-model comparison table */}
            {r.forecast_snapshot.ensemble_models && r.forecast_snapshot.ensemble_models.length >= 2 && (
              <div>
                <Separator className="mb-3" />
                <p className="text-xs font-semibold mb-2">Per-Model Comparison</p>
                <div className="rounded-lg border overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] text-xs">
                    {/* Header */}
                    <div className="px-3 py-2 bg-muted/50 font-medium">Model</div>
                    <div className="px-3 py-2 bg-muted/50 font-medium text-right">Members</div>
                    <div className="px-3 py-2 bg-muted/50 font-medium text-right">P50</div>
                    <div className="px-3 py-2 bg-muted/50 font-medium text-right">&#963;</div>
                    <div className="px-3 py-2 bg-muted/50 font-medium text-right">P10-P90</div>
                    <div className="px-3 py-2 bg-muted/50 font-medium text-right">Prob</div>
                    {/* Rows */}
                    {r.forecast_snapshot.ensemble_models.map((m, i) => {
                      const label = m.model === "ecmwf_ifs025" ? "ECMWF IFS" : m.model === "gfs025" ? "GFS" : m.model;
                      return (
                        <div key={m.model} className="contents">
                          <div className={`px-3 py-2 font-medium flex items-center gap-1.5 ${i > 0 ? "border-t" : ""}`}>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${m.model === "ecmwf_ifs025" ? "bg-indigo-500" : "bg-amber-500"}`} />
                            {label}
                          </div>
                          <div className={`px-3 py-2 text-right font-mono text-muted-foreground ${i > 0 ? "border-t" : ""}`}>{m.member_count}</div>
                          <div className={`px-3 py-2 text-right font-mono ${i > 0 ? "border-t" : ""}`}>{m.p50} {unit}</div>
                          <div className={`px-3 py-2 text-right font-mono ${i > 0 ? "border-t" : ""}`}>{m.std} {unit}</div>
                          <div className={`px-3 py-2 text-right font-mono text-muted-foreground ${i > 0 ? "border-t" : ""}`}>{m.p10} - {m.p90} {unit}</div>
                          <div className={`px-3 py-2 text-right font-mono font-semibold ${i > 0 ? "border-t" : ""}`}>
                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {(m.prob * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {/* Combined row */}
                    <div className="contents">
                      <div className="px-3 py-2 border-t-2 font-semibold bg-muted/30">Combined</div>
                      <div className="px-3 py-2 border-t-2 text-right font-mono font-semibold bg-muted/30">{r.forecast_snapshot.ensemble_member_count}</div>
                      <div className="px-3 py-2 border-t-2 text-right font-mono font-semibold bg-muted/30">{r.forecast_snapshot.ensemble_p50} {unit}</div>
                      <div className="px-3 py-2 border-t-2 text-right font-mono font-semibold bg-muted/30">{r.forecast_snapshot.ensemble_std} {unit}</div>
                      <div className="px-3 py-2 border-t-2 text-right font-mono font-semibold bg-muted/30">{r.forecast_snapshot.ensemble_p10} - {r.forecast_snapshot.ensemble_p90} {unit}</div>
                      <div className="px-3 py-2 border-t-2 text-right font-mono font-bold bg-muted/30">
                        <span className="bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                          {r.model_prob != null ? `${(r.model_prob * 100).toFixed(1)}%` : "--"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pooled histogram */}
            <div className="pt-1">
              <Separator className="mb-3" />
              <p className="text-xs text-muted-foreground mb-2">Pooled member distribution ({unit})</p>
              <div className="flex gap-0.5 items-end h-16">
                {(() => {
                  const members = r.forecast_snapshot!.ensemble_members!;
                  const min = Math.min(...members);
                  const max = Math.max(...members);
                  const range = max - min || 1;
                  const bucketCount = 16;
                  const buckets = new Array(bucketCount).fill(0);
                  members.forEach((m: number) => {
                    const idx = Math.min(bucketCount - 1, Math.floor(((m - min) / range) * bucketCount));
                    buckets[idx]++;
                  });
                  const maxCount = Math.max(...buckets);
                  return buckets.map((count: number, i: number) => (
                    <div
                      key={i}
                      className="flex-1 bg-indigo-400 dark:bg-indigo-500 rounded-t-sm transition-all hover:bg-indigo-500 dark:hover:bg-indigo-400"
                      style={{ height: maxCount > 0 ? `${Math.max(4, (count / maxCount) * 100)}%` : "4%" }}
                      title={`${(min + (i / bucketCount) * range).toFixed(1)} - ${(min + ((i + 1) / bucketCount) * range).toFixed(1)} ${unit}: ${count} members`}
                    />
                  ));
                })()}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                <span>{Math.min(...r.forecast_snapshot.ensemble_members).toFixed(1)} {unit}</span>
                <span>{Math.max(...r.forecast_snapshot.ensemble_members).toFixed(1)} {unit}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Backtest ═══ */}
      <BacktestSection
        runId={r.id}
        isPast={isPast}
        backtested={!!r.backtested_at}
        actualTemp={r.actual_temp}
        resolvedYes={r.resolved_yes}
        pnl={r.pnl}
        forecastTemp={r.forecast_snapshot?.forecast_temp ?? null}
        recommendation={r.recommendation}
        yesPrice={r.yes_price}
        noPrice={r.no_price}
        feeBps={r.fee_bps}
        slippageBps={r.slippage_bps}
        suggestedSize={tp?.suggested_size_usd ?? 0}
        ruleType={r.rule_type}
        thresholdLow={r.threshold_low}
        thresholdHigh={r.threshold_high}
        forecastTemps={r.forecast_snapshot?.hourly_temps ?? []}
        forecastTimes={r.forecast_snapshot?.hourly_times ?? []}
        lat={r.lat ?? 0}
        lon={r.lon ?? 0}
        resolutionTime={r.resolution_time}
      />

      {/* ═══ Forecast Chart (only shown when not backtested, since backtest has its own chart) ═══ */}
      {!r.backtested_at && r.forecast_snapshot && (
        <ForecastChartSection
          forecastTemps={r.forecast_snapshot.hourly_temps}
          forecastTimes={r.forecast_snapshot.hourly_times}
          thresholdLow={r.threshold_low}
          thresholdHigh={r.threshold_high}
          forecastTemp={r.forecast_snapshot.forecast_temp}
          targetTime={r.forecast_snapshot.target_time}
        />
      )}

      {/* ═══ Trade Plan ═══ */}
      {tp && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Trade Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Rationale with highlighted numbers */}
            <div>
              <p className="font-semibold mb-2 flex items-center gap-2">
                Rationale
                <Badge variant="outline" className="text-[10px] font-normal">
                  {tp.rationale.length} points
                </Badge>
              </p>
              <div className="space-y-1.5">
                {tp.rationale.map((item, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-muted-foreground shrink-0 mt-0.5 text-xs font-mono w-4 text-right">{i + 1}</span>
                    <p className="text-sm leading-relaxed"
                       dangerouslySetInnerHTML={{
                         __html: item
                           // Highlight percentages
                           .replace(/(\d+\.?\d*%)/g, '<span class="font-mono font-semibold bg-primary/10 text-primary px-1 rounded">$1</span>')
                           // Highlight dollar amounts
                           .replace(/(\$\d+\.?\d*)/g, '<span class="font-mono font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1 rounded">$1</span>')
                           // Highlight temperatures
                           .replace(/([\d.-]+)(\u00b0C|°C)/g, '<span class="font-mono font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1 rounded">$1$2</span>')
                       }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            {/* Assumptions */}
            <div>
              <p className="font-semibold mb-2">Key Assumptions</p>
              <ul className="space-y-1.5">
                {tp.assumptions.map((a, i) => (
                  <li key={i} className="flex gap-2 items-start text-sm">
                    <span className="text-muted-foreground shrink-0 mt-0.5">&#8226;</span>
                    <span className="text-muted-foreground">{a}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Separator />
            {/* Invalidated If */}
            <div>
              <p className="font-semibold mb-2 text-red-600 dark:text-red-400">Invalidated If</p>
              <ul className="space-y-1.5">
                {tp.invalidated_if.map((inv, i) => (
                  <li key={i} className="flex gap-2 items-start text-sm">
                    <span className="text-red-500 shrink-0 mt-0.5">&#9888;</span>
                    <span className="text-red-600 dark:text-red-400">{inv}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Market Details (collapsed style) ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Market Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">URL</span>
              <a
                href={r.market_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline truncate max-w-[200px] text-right"
              >
                View on Polymarket &#8599;
              </a>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Resolution</span>
              <span className="font-mono text-xs">
                {new Date(r.resolution_time).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Location</span>
              <span className="font-medium">{r.location_text} <span className="text-muted-foreground text-xs">({r.lat}, {r.lon})</span></span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Rule</span>
              <Badge variant="outline" className="font-mono text-xs">{ruleDesc}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">YES / NO</span>
              <div className="flex gap-2">
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 font-mono">
                  {r.yes_price}
                </Badge>
                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 font-mono">
                  {r.no_price}
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Fees / Slippage</span>
              <span className="font-mono text-xs">{r.fee_bps}bps / {r.slippage_bps}bps</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Sigma</span>
              <span className="font-mono">{r.sigma_temp} {unit}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Confidence</span>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${r.user_confidence}%` }}
                  />
                </div>
                <span className="font-mono text-xs">{r.user_confidence}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">Prob Method</span>
              <Badge variant={r.forecast_snapshot?.prob_method === "ensemble" ? "default" : "secondary"} className="text-xs">
                {r.forecast_snapshot?.prob_method === "ensemble"
                  ? `Ensemble (${r.forecast_snapshot.ensemble_model})`
                  : "Normal Dist."}
              </Badge>
            </div>
            {tp?.kelly_fraction != null && tp.kelly_fraction > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <span className="text-muted-foreground">Kelly</span>
                <div className="flex gap-1.5 items-center">
                  <Badge variant="outline" className="font-mono text-xs">
                    {(tp.kelly_fraction * 100).toFixed(1)}%
                  </Badge>
                  <span className="text-muted-foreground text-xs">&#8594;</span>
                  <span className="font-mono text-xs font-medium">${tp.kelly_size_usd?.toFixed(2)}</span>
                  <span className="text-muted-foreground text-xs">&#183; &#189;K ${tp.half_kelly_size_usd?.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══ AI Summary ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              AI Summary
              {r.ai_summary && (
                <Badge variant="outline" className="text-[10px] font-normal">AI-generated</Badge>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {r.ai_summary ? (
            <div className="rounded-lg border bg-muted/30 p-5">
              <AiSummaryContent text={r.ai_summary} />
            </div>
          ) : (
            <AiSummaryButton runId={r.id} />
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Link href="/runs">
          <Button variant="outline">Back to Runs</Button>
        </Link>
        <Link href="/new">
          <Button>New Analysis</Button>
        </Link>
      </div>
    </div>
  );
}
