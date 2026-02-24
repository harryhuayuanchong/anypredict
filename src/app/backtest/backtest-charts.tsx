"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, Line,
  ComposedChart, Area, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ScenarioResult } from "@/lib/types";

interface Props {
  scenario: ScenarioResult;
}

export function BacktestCharts({ scenario }: Props) {
  const { dailyPnl, monthlyPnl, cityBreakdown, tradeTypeBreakdown, calibration, edgeHistogram } = scenario;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Cumulative P&L — full width */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Cumulative P&L</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={dailyPnl} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.toLocaleString("en", { month: "short" })} ${d.getDate()}`;
                }}
                interval={Math.floor(dailyPnl.length / 8)}
              />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cumulative P&L"]}
                labelFormatter={(label) => new Date(String(label)).toLocaleDateString()}
                contentStyle={{ fontSize: 12 }}
              />
              <ReferenceLine y={0} stroke="#a3a3a3" strokeDasharray="3 3" />
              <Area
                type="monotone" dataKey="cumulative"
                fill="#6366f120" stroke="#6366f1" strokeWidth={2} dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly P&L */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly P&L</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyPnl} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => {
                  const [y, m] = v.split("-");
                  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
                }}
              />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                formatter={(value) => [`$${Number(value).toFixed(2)}`, "P&L"]}
                contentStyle={{ fontSize: 12 }}
              />
              <ReferenceLine y={0} stroke="#a3a3a3" strokeDasharray="3 3" />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {monthlyPnl.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Per-City P&L */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">P&L by City</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cityBreakdown} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <YAxis type="category" dataKey="city" tick={{ fontSize: 11 }} width={90} />
              <Tooltip
                formatter={(value) => [`$${Number(value).toFixed(2)}`, "P&L"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
                {cityBreakdown.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Calibration Chart */}
      {calibration.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model Calibration</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  type="number" dataKey="predicted" name="Predicted"
                  tick={{ fontSize: 11 }} domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  label={{ value: "Predicted %", position: "insideBottom", offset: -2, fontSize: 10 }}
                />
                <YAxis
                  type="number" tick={{ fontSize: 11 }} domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  label={{ value: "Actual %", angle: -90, position: "insideLeft", offset: 15, fontSize: 10 }}
                />
                <Tooltip
                  formatter={(value, name) => [`${value}%`, name === "actual" ? "Actual" : "Perfect"]}
                  contentStyle={{ fontSize: 12 }}
                />
                {/* Perfect calibration diagonal */}
                <Line
                  data={[{ predicted: 0, perfect: 0 }, { predicted: 100, perfect: 100 }]}
                  type="linear" dataKey="perfect" stroke="#a3a3a3"
                  strokeDasharray="5 5" dot={false} legendType="none"
                />
                {/* Actual calibration */}
                <Line
                  data={calibration}
                  type="monotone" dataKey="actual" stroke="#6366f1"
                  strokeWidth={2} dot={{ r: 4, fill: "#6366f1" }}
                />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  {...{ payload: [
                    { value: "Actual", type: "circle", color: "#6366f1" },
                    { value: "Perfect", type: "line", color: "#a3a3a3" },
                  ] } as any}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Edge Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edge Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={edgeHistogram} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* BUY YES vs BUY NO breakdown */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Trade Type Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {tradeTypeBreakdown.map((tt) => (
              <div key={tt.side} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={tt.side === "BUY_YES" ? "default" : "secondary"}>
                    {tt.side === "BUY_YES" ? "BUY YES" : "BUY NO"}
                  </Badge>
                  <span className={`text-lg font-bold font-mono ${tt.pnl >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {tt.pnl >= 0 ? "+" : ""}${tt.pnl.toFixed(2)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Trades</div>
                    <div className="font-mono font-semibold">{tt.trades.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Win Rate</div>
                    <div className="font-mono font-semibold">{tt.winRate}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Avg Edge</div>
                    <div className="font-mono font-semibold">{tt.avgEdge}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
