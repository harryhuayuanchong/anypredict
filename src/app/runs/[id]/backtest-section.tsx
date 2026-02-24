"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ForecastVsActualChart } from "@/components/charts";

interface Props {
  runId: string;
  isPast: boolean;
  backtested: boolean;
  actualTemp: number | null;
  resolvedYes: boolean | null;
  pnl: number | null;
  forecastTemp: number | null;
  recommendation: string | null;
  // For the overlay chart
  yesPrice: number;
  noPrice: number;
  feeBps: number;
  slippageBps: number;
  suggestedSize: number;
  ruleType: string;
  thresholdLow: number | null;
  thresholdHigh: number | null;
  // Forecast data for chart overlay
  forecastTemps: number[];
  forecastTimes: string[];
  // For fetching actual hourly data
  lat: number;
  lon: number;
  resolutionTime: string;
}

export function BacktestSection({
  runId,
  isPast,
  backtested,
  actualTemp,
  resolvedYes,
  pnl,
  forecastTemp,
  recommendation,
  yesPrice,
  noPrice,
  feeBps,
  slippageBps,
  suggestedSize,
  ruleType,
  thresholdLow,
  thresholdHigh,
  forecastTemps,
  forecastTimes,
  lat,
  lon,
  resolutionTime,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);

  // Actual hourly data for chart overlay
  const [actualHourly, setActualHourly] = useState<{
    temps: number[];
    times: string[];
  } | null>(null);

  // Fetch actual hourly data when backtested (for chart)
  useEffect(() => {
    if (!backtested || !lat || !lon || !resolutionTime) return;

    const dayStr = new Date(resolutionTime).toISOString().split("T")[0];
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dayStr}&end_date=${dayStr}&hourly=temperature_2m&timezone=auto`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.hourly?.temperature_2m && data.hourly?.time) {
          setActualHourly({
            temps: data.hourly.temperature_2m,
            times: data.hourly.time,
          });
        }
      })
      .catch(() => {
        // Silently fail — chart just won't show actual
      });
  }, [backtested, lat, lon, resolutionTime]);

  const handleBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Backtest failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  // Build threshold description
  const ruleDesc =
    ruleType === "above_below"
      ? thresholdLow != null && thresholdHigh == null
        ? `temp >= ${thresholdLow} C`
        : `temp <= ${thresholdHigh} C`
      : `${thresholdLow} C - ${thresholdHigh} C`;

  // ─── How it works explainer ───
  const Explainer = () => (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-base">&#9432;</span>
        <span className="font-semibold">How Backtest Works</span>
      </div>
      <div className="space-y-2 text-muted-foreground">
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[10px] font-bold text-blue-600 dark:text-blue-400">1</span>
          <div>
            <span className="font-medium text-foreground">Fetch actual temperature</span>
            <p className="text-xs mt-0.5">
              Open-Meteo Archive API provides verified historical weather data (daily max &amp; hourly temps). Data is typically available 5+ days after the date.
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[10px] font-bold text-blue-600 dark:text-blue-400">2</span>
          <div>
            <span className="font-medium text-foreground">Resolve the market</span>
            <p className="text-xs mt-0.5">
              Compare actual daily high temp against the market rule (<code className="bg-muted px-1 rounded text-[10px]">{ruleDesc}</code>). If condition is met &#8594; resolves YES, otherwise NO.
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[10px] font-bold text-blue-600 dark:text-blue-400">3</span>
          <div>
            <span className="font-medium text-foreground">Calculate P&amp;L</span>
            <p className="text-xs mt-0.5">
              BUY YES at price P: win &#8594; +(1-P) &#215; size, loss &#8594; -P &#215; size.<br />
              BUY NO at price (1-P): win &#8594; +P &#215; size, loss &#8594; -(1-P) &#215; size.<br />
              Fees &amp; slippage deducted from gross P&amp;L on entry.
            </p>
          </div>
        </div>
      </div>
      <div className="pt-1 text-[10px] text-muted-foreground flex items-center gap-1.5">
        <span>Data source:</span>
        <a
          href="https://open-meteo.com/en/docs/historical-weather-api"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          Open-Meteo Historical Weather API
        </a>
        <span>&#183; Free, no API key &#183; Verified station data</span>
      </div>
    </div>
  );

  // ─── Not yet resolvable ───
  if (!isPast && !backtested) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Backtest</CardTitle>
            <Badge variant="outline" className="text-[10px]">Pending</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Resolution time hasn&apos;t passed yet. Backtest will be available after the market resolves.
          </p>
          <button
            onClick={() => setShowExplainer(!showExplainer)}
            className="text-xs text-primary hover:underline"
          >
            {showExplainer ? "Hide" : "How does backtest work?"}
          </button>
          {showExplainer && <Explainer />}
        </CardContent>
      </Card>
    );
  }

  // ─── Ready to backtest ───
  if (!backtested) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Backtest</CardTitle>
            <Badge variant="secondary" className="text-[10px]">Ready</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Resolution time has passed. Fetch actual temperature data from Open-Meteo Archive and calculate P&amp;L.
          </p>
          <Explainer />
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <Button onClick={handleBacktest} disabled={loading} size="lg" className="w-full sm:w-auto">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Fetching actual data &amp; computing...
              </span>
            ) : (
              "Run Backtest"
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── Show backtest results ───
  const forecastError =
    forecastTemp != null && actualTemp != null
      ? Math.round((actualTemp - forecastTemp) * 10) / 10
      : null;

  const isWin = pnl != null && pnl >= 0;
  const isNoTrade = recommendation === "NO_TRADE";
  const wasCorrect =
    recommendation === "BUY_YES"
      ? resolvedYes === true
      : recommendation === "BUY_NO"
      ? resolvedYes === false
      : null;

  // P&L breakdown calculation
  const totalCostRate = (feeBps + slippageBps) / 10000;
  const fees = Math.round(totalCostRate * suggestedSize * 100) / 100;
  let grossPnl = 0;
  if (recommendation === "BUY_YES") {
    grossPnl = resolvedYes
      ? Math.round((1 - yesPrice) * suggestedSize * 100) / 100
      : Math.round(-yesPrice * suggestedSize * 100) / 100;
  } else if (recommendation === "BUY_NO") {
    grossPnl = !resolvedYes
      ? Math.round(yesPrice * suggestedSize * 100) / 100
      : Math.round(-(1 - yesPrice) * suggestedSize * 100) / 100;
  }

  const resultBg = isNoTrade
    ? "border-border"
    : isWin
    ? "border-green-300 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20"
    : "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20";

  return (
    <Card className={`border-2 ${resultBg}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            Backtest Result
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={isNoTrade ? "outline" : isWin ? "default" : "destructive"}
              className="text-xs"
            >
              {isNoTrade ? "NO TRADE" : isWin ? "WIN" : "LOSS"}
            </Badge>
            {!isNoTrade && (
              <span className={`text-lg font-bold font-mono ${isWin ? "text-green-600" : "text-red-600"}`}>
                {pnl != null && pnl >= 0 ? "+" : ""}${pnl?.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Result cards */}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Actual Temp (High)</p>
            <p className="text-2xl font-bold font-mono mt-0.5">{actualTemp?.toFixed(1)}&#176;C</p>
            {forecastError != null && (
              <p className={`text-xs font-mono mt-0.5 ${Math.abs(forecastError) <= 1.5 ? "text-green-600" : Math.abs(forecastError) <= 3 ? "text-orange-500" : "text-red-600"}`}>
                {forecastError > 0 ? "+" : ""}{forecastError}&#176;C vs forecast
              </p>
            )}
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Forecast Temp</p>
            <p className="text-2xl font-bold font-mono mt-0.5">{forecastTemp?.toFixed(1)}&#176;C</p>
            <p className="text-xs text-muted-foreground mt-0.5">at time of run</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Market Resolved</p>
            <p className={`text-2xl font-bold mt-0.5 ${resolvedYes ? "text-green-600" : "text-red-600"}`}>
              {resolvedYes ? "YES" : "NO"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ruleDesc}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Signal Correct?</p>
            <p className={`text-2xl font-bold mt-0.5 ${wasCorrect === null ? "text-muted-foreground" : wasCorrect ? "text-green-600" : "text-red-600"}`}>
              {wasCorrect === null ? "N/A" : wasCorrect ? "Yes" : "No"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Signal: {recommendation}
            </p>
          </div>
        </div>

        {/* Forecast vs Actual chart */}
        {forecastTemps.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-sm font-semibold mb-2">Forecast vs Actual Temperature</p>
              <p className="text-xs text-muted-foreground mb-3">
                Purple line = forecast at time of run. Orange line = actual recorded temperatures. Red dashed = market threshold.
              </p>
              <ForecastVsActualChart
                forecastTemps={forecastTemps}
                forecastTimes={forecastTimes}
                actualTemps={actualHourly?.temps}
                actualTimes={actualHourly?.times}
                thresholdLow={thresholdLow}
                thresholdHigh={thresholdHigh}
              />
            </div>
          </>
        )}

        {/* P&L Breakdown */}
        {!isNoTrade && (
          <>
            <Separator />
            <div>
              <p className="text-sm font-semibold mb-3">P&amp;L Breakdown</p>
              <div className="rounded-lg border bg-muted/20 overflow-hidden">
                <div className="grid grid-cols-[1fr_auto] text-sm">
                  {/* Row 1: Action */}
                  <div className="px-4 py-2.5 border-b">
                    <span className="text-muted-foreground">Action</span>
                  </div>
                  <div className="px-4 py-2.5 border-b text-right">
                    <Badge variant={recommendation === "BUY_YES" ? "default" : "secondary"} className="text-xs">
                      {recommendation}
                    </Badge>
                    <span className="text-muted-foreground text-xs ml-2">
                      at {recommendation === "BUY_YES" ? yesPrice : noPrice}
                    </span>
                  </div>

                  {/* Row 2: Position size */}
                  <div className="px-4 py-2.5 border-b">
                    <span className="text-muted-foreground">Position size</span>
                  </div>
                  <div className="px-4 py-2.5 border-b text-right font-mono">
                    ${suggestedSize.toFixed(2)}
                  </div>

                  {/* Row 3: Outcome */}
                  <div className="px-4 py-2.5 border-b">
                    <span className="text-muted-foreground">Market outcome</span>
                  </div>
                  <div className="px-4 py-2.5 border-b text-right">
                    <span className={resolvedYes ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                      Resolved {resolvedYes ? "YES" : "NO"}
                    </span>
                  </div>

                  {/* Row 4: Gross P&L with formula */}
                  <div className="px-4 py-2.5 border-b">
                    <span className="text-muted-foreground">Gross P&amp;L</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                      {recommendation === "BUY_YES"
                        ? resolvedYes
                          ? `(1 - ${yesPrice}) x $${suggestedSize.toFixed(2)}`
                          : `-${yesPrice} x $${suggestedSize.toFixed(2)}`
                        : !resolvedYes
                        ? `${yesPrice} x $${suggestedSize.toFixed(2)}`
                        : `-(1 - ${yesPrice}) x $${suggestedSize.toFixed(2)}`}
                    </p>
                  </div>
                  <div className={`px-4 py-2.5 border-b text-right font-mono font-medium ${grossPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {grossPnl >= 0 ? "+" : ""}${grossPnl.toFixed(2)}
                  </div>

                  {/* Row 5: Fees */}
                  <div className="px-4 py-2.5 border-b">
                    <span className="text-muted-foreground">Fees &amp; slippage</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                      ({feeBps}bp + {slippageBps}bp) x ${suggestedSize.toFixed(2)}
                    </p>
                  </div>
                  <div className="px-4 py-2.5 border-b text-right font-mono text-red-600">
                    -${fees.toFixed(2)}
                  </div>

                  {/* Row 6: Net P&L (highlighted) */}
                  <div className="px-4 py-3 bg-muted/50 font-semibold">
                    Net P&amp;L
                  </div>
                  <div className={`px-4 py-3 bg-muted/50 text-right font-mono font-bold text-lg ${isWin ? "text-green-600" : "text-red-600"}`}>
                    {pnl != null && pnl >= 0 ? "+" : ""}${pnl?.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Explainer toggle */}
        <div className="pt-1">
          <button
            onClick={() => setShowExplainer(!showExplainer)}
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            {showExplainer ? "Hide methodology" : "How does backtest work?"}
          </button>
          {showExplainer && (
            <div className="mt-3">
              <Explainer />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
