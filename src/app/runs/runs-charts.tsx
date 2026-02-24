"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlWaterfallChart, EdgeAccuracyChart, ForecastErrorChart } from "@/components/charts";

interface Props {
  pnlRuns: {
    id: string;
    title: string;
    pnl: number;
    date: string;
    model_prob: number;
    market_prob: number;
    resolved_yes: boolean;
  }[];
  errorBuckets: { range: string; count: number }[];
}

export function RunsCharts({ pnlRuns, errorBuckets }: Props) {
  const hasData = pnlRuns.length > 0;
  const hasErrors = errorBuckets.some((b) => b.count > 0);

  if (!hasData && !hasErrors) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {hasData && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">P&L by Run</CardTitle>
          </CardHeader>
          <CardContent>
            <PnlWaterfallChart runs={pnlRuns} />
          </CardContent>
        </Card>
      )}

      {hasData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model vs Market vs Outcome</CardTitle>
          </CardHeader>
          <CardContent>
            <EdgeAccuracyChart runs={pnlRuns} />
          </CardContent>
        </Card>
      )}

      {hasErrors && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Forecast Error Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ForecastErrorChart errors={errorBuckets} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
