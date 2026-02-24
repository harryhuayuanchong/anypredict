"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BacktestCharts } from "./backtest-charts";
import type { BacktestOutput, ScenarioResult } from "@/lib/types";

const PROGRESS_MESSAGES = [
  "Fetching temperature data from Open-Meteo...",
  "Loading 5 years of climate history...",
  "Running ensemble simulation (82 members)...",
  "Computing probabilities for all buckets...",
  "Calculating edge and Kelly sizing...",
  "Resolving markets against actuals...",
  "Aggregating P&L and metrics...",
];

const SCENARIO_INFO: Record<string, { title: string; what: string; how: string; implication: string }> = {
  "Climatological Market": {
    title: "vs Climatological Market",
    what: "Simulates a market where prices are set purely by historical base rates — as if traders only looked at 5 years of climate data and ignored weather forecasts entirely.",
    how: "Each temperature bucket is priced by its historical frequency (Laplace-smoothed). For example, if \"72-73°F\" occurred 8% of the time historically, that bucket is priced at ¢8.",
    implication: "This is the easiest market to beat. Our ensemble forecast (ECMWF + GFS) has real information about tomorrow's weather that the market completely ignores. Most of our edge comes from BUY NO on tail buckets that are overpriced by climate averages.",
  },
  "Noisy Forecast Market": {
    title: "vs Noisy Forecast Market",
    what: "Simulates a more realistic market where traders use weather forecasts, but with lower accuracy than our ensemble model (σ = 2.5°C uncertainty vs our ~1.0°C).",
    how: "Market prices are derived from a Normal distribution around a noisy forecast (actual temp + Gaussian bias at σ = 1.8°C), with σ = 2.5°C spread. Our model uses a tighter 82-member ensemble.",
    implication: "This is a harder but more realistic scenario. Edge is smaller because the market already has forecast information. Our advantage comes from having more ensemble members and tighter calibration.",
  },
};

interface BacktestConfigState {
  start: string;
  end: string;
  feeBps: string;
  slippageBps: string;
  baseSizeUsd: string;
  confidence: string;
}

const DEFAULT_CONFIG: BacktestConfigState = {
  start: "2025-08-15",
  end: "2026-02-15",
  feeBps: "100",
  slippageBps: "50",
  baseSizeUsd: "100",
  confidence: "70",
};

type BacktestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: BacktestOutput }
  | { status: "error"; message: string };

export function BacktestClient() {
  const [state, setState] = useState<BacktestState>({ status: "idle" });
  const [msgIdx, setMsgIdx] = useState(0);
  const [config, setConfig] = useState<BacktestConfigState>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);

  const buildUrl = useCallback((fresh: boolean) => {
    const params = new URLSearchParams();
    if (fresh) params.set("fresh", "1");
    if (config.start !== DEFAULT_CONFIG.start) params.set("start", config.start);
    if (config.end !== DEFAULT_CONFIG.end) params.set("end", config.end);
    if (config.feeBps !== DEFAULT_CONFIG.feeBps) params.set("feeBps", config.feeBps);
    if (config.slippageBps !== DEFAULT_CONFIG.slippageBps) params.set("slippageBps", config.slippageBps);
    if (config.baseSizeUsd !== DEFAULT_CONFIG.baseSizeUsd) params.set("baseSizeUsd", config.baseSizeUsd);
    if (config.confidence !== DEFAULT_CONFIG.confidence) params.set("confidence", config.confidence);
    const qs = params.toString();
    return `/api/strategy-backtest${qs ? `?${qs}` : ""}`;
  }, [config]);

  const runBacktest = useCallback(async (fresh = false) => {
    setState({ status: "loading" });
    setMsgIdx(0);
    try {
      const url = buildUrl(fresh);
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data: BacktestOutput = await res.json();
      setState({ status: "done", data });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Failed" });
    }
  }, [buildUrl]);

  // Auto-run on mount
  useEffect(() => { runBacktest(); }, [runBacktest]);

  // Cycle progress messages
  useEffect(() => {
    if (state.status !== "loading") return;
    const interval = setInterval(() => {
      setMsgIdx((prev) => (prev + 1) % PROGRESS_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [state.status]);

  // ── Config Panel (always visible) ──
  const configPanel = (
    <Card>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowConfig((v) => !v)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Configuration</CardTitle>
          <span className="text-xs text-muted-foreground">
            {showConfig ? "▲ Hide" : "▼ Show"} &middot; ${config.baseSizeUsd} base &middot; {config.confidence}% confidence &middot; Fee {config.feeBps} bps &middot; Slip {config.slippageBps} bps &middot; {config.start} → {config.end}
          </span>
        </div>
      </CardHeader>
      {showConfig && (
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bt-start" className="text-xs">Start Date</Label>
              <Input
                id="bt-start" type="date" value={config.start}
                onChange={(e) => setConfig((c) => ({ ...c, start: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-end" className="text-xs">End Date</Label>
              <Input
                id="bt-end" type="date" value={config.end}
                onChange={(e) => setConfig((c) => ({ ...c, end: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-base" className="text-xs">Base Size ($)</Label>
              <Input
                id="bt-base" type="number" min={10} max={10000} step={10} value={config.baseSizeUsd}
                onChange={(e) => setConfig((c) => ({ ...c, baseSizeUsd: e.target.value }))}
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Max per trade: ${(parseInt(config.baseSizeUsd) * 0.25 * 0.5 * parseInt(config.confidence) / 100).toFixed(2)}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-conf" className="text-xs">Confidence (%)</Label>
              <Input
                id="bt-conf" type="number" min={10} max={100} step={5} value={config.confidence}
                onChange={(e) => setConfig((c) => ({ ...c, confidence: e.target.value }))}
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Model trust level</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-fee" className="text-xs">Fee (bps)</Label>
              <Input
                id="bt-fee" type="number" min={0} max={500} step={10} value={config.feeBps}
                onChange={(e) => setConfig((c) => ({ ...c, feeBps: e.target.value }))}
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">{(parseInt(config.feeBps) / 100).toFixed(2)}%</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bt-slip" className="text-xs">Slippage (bps)</Label>
              <Input
                id="bt-slip" type="number" min={0} max={500} step={10} value={config.slippageBps}
                onChange={(e) => setConfig((c) => ({ ...c, slippageBps: e.target.value }))}
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">{(parseInt(config.slippageBps) / 100).toFixed(2)}%</p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <Button size="sm" onClick={() => runBacktest(true)} disabled={state.status === "loading"}>
              Run Backtest
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfig(DEFAULT_CONFIG)}>
              Reset to Defaults
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );

  // ── Loading State ──
  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Strategy Backtest</h1>
        {configPanel}
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 border-4 border-muted rounded-full" />
              <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin" />
            </div>
            <p className="text-sm font-medium text-muted-foreground animate-pulse">
              {PROGRESS_MESSAGES[msgIdx]}
            </p>
            <p className="text-xs text-muted-foreground">
              This takes 10-30 seconds on first load (cached for 1 hour after)
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error State ──
  if (state.status === "error") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Strategy Backtest</h1>
        {configPanel}
        <Card>
          <CardContent className="py-8">
            <div className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
              {state.message}
            </div>
            <Button className="mt-4" onClick={() => runBacktest(true)}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Results ──
  const { data } = state;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Strategy Backtest</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.config.start} &rarr; {data.config.end} &middot; {data.config.cities.join(", ")}
            &middot; ${data.config.baseSize} base &middot; {data.config.confidence}% confidence
            &middot; Fee {data.config.feeBps} bps &middot; Slip {data.config.slippageBps} bps
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => runBacktest(true)}>
          Rerun
        </Button>
      </div>

      {/* Config Panel */}
      {configPanel}

      {/* Scenario Tabs */}
      <Tabs defaultValue="climatological">
        <TabsList>
          <TabsTrigger value="climatological">vs Climatological Market</TabsTrigger>
          <TabsTrigger value="noisy">vs Noisy Forecast Market</TabsTrigger>
        </TabsList>

        <TabsContent value="climatological">
          <ScenarioView scenario={data.scenarios[0]} />
        </TabsContent>
        <TabsContent value="noisy">
          <ScenarioView scenario={data.scenarios[1]} />
        </TabsContent>
      </Tabs>

      {/* Methodology */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Methodology &amp; Limitations</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Real data:</strong> Actual daily max temperatures from Open-Meteo Archive API
            ({data.config.cities.length} cities, {data.config.start} to {data.config.end}).
            Climatology from 2019-2024 (5 years).
          </p>
          <p>
            <strong className="text-foreground">Simulated:</strong> Ensemble forecasts (actual temp + calibrated Gaussian noise:
            ECMWF 51 members at 1.0&deg;C spread, GFS 31 members at 1.3&deg;C spread).
            Market prices (Climatological: 5-year base rates; Noisy Forecast: 2.5&deg;C uncertainty model).
          </p>
          <p>
            <strong className="text-foreground">Not included:</strong> Real Polymarket prices, actual historical ensemble runs,
            order book depth, liquidity constraints. Results vary slightly between runs (Monte Carlo).
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            Computed at: {new Date(data.computedAt).toLocaleString()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Scenario View ──

function ScenarioView({ scenario }: { scenario: ScenarioResult }) {
  const { metrics } = scenario;
  const info = SCENARIO_INFO[scenario.name];

  return (
    <div className="space-y-6 mt-4">
      {/* Scenario Explanation */}
      {info && (
        <Card className="border-dashed">
          <CardContent className="pt-5 pb-4 text-sm space-y-2">
            <p><strong className="text-foreground">What is this?</strong> {info.what}</p>
            <p><strong className="text-foreground">How prices are set:</strong> {info.how}</p>
            <p><strong className="text-foreground">Implication:</strong> {info.implication}</p>
          </CardContent>
        </Card>
      )}

      {/* Hero Stats */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Big P&L */}
            <div className="flex-shrink-0">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Total P&L</div>
              <div className={`text-4xl font-black font-mono ${metrics.totalPnl >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {metrics.totalPnl >= 0 ? "+" : ""}${metrics.totalPnl.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {metrics.wins}W / {metrics.losses}L &middot; {metrics.totalTrades.toLocaleString()} trades
              </div>
            </div>

            {/* Secondary metrics grid */}
            <div className="flex-1 grid grid-cols-3 sm:grid-cols-5 gap-4">
              <StatBox label="Win Rate" value={`${metrics.winRate}%`} />
              <StatBox label="ROI" value={`${metrics.roi}%`} positive={metrics.roi > 0} />
              <StatBox label="Sharpe" value={metrics.sharpe.toFixed(1)} positive={metrics.sharpe > 1} />
              <StatBox label="Profit Factor" value={`${metrics.profitFactor}x`} />
              <StatBox label="Max Drawdown" value={`-$${metrics.maxDrawdown.toFixed(2)}`} negative />
            </div>
          </div>

          {/* Notable trades */}
          <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Best trade: </span>
              <span className="font-mono text-emerald-600">+${metrics.bestTrade.pnl.toFixed(2)}</span>
              <span className="text-muted-foreground"> ({metrics.bestTrade.city}, {metrics.bestTrade.date})</span>
            </div>
            <div>
              <span className="text-muted-foreground">Worst trade: </span>
              <span className="font-mono text-red-600">-${Math.abs(metrics.worstTrade.pnl).toFixed(2)}</span>
              <span className="text-muted-foreground"> ({metrics.worstTrade.city}, {metrics.worstTrade.date})</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* All charts */}
      <BacktestCharts scenario={scenario} />
    </div>
  );
}

function StatBox({ label, value, positive, negative }: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  let color = "text-foreground";
  if (positive) color = "text-emerald-600";
  if (negative) color = "text-red-600";

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
