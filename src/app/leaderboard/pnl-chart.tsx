"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ChartPoint } from "@/lib/leaderboard/types";

function formatTime(ms: number) {
  const date = new Date(ms);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function PnlChart({ data }: { data: ChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[260px] text-muted-foreground text-sm">
        No closed positions yet.
      </div>
    );
  }

  // Deduplicate by second
  const bySecond = new Map<number, number>();
  const sorted = [...data].sort((a, b) => a.time - b.time);
  for (const p of sorted) {
    bySecond.set(Math.floor(p.time / 1000), p.value);
  }
  const normalized = Array.from(bySecond.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: time * 1000, value }));

  const lastValue = normalized[normalized.length - 1]?.value ?? 0;
  const lineColor = lastValue >= 0 ? "#22c55e" : "#ef4444";

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={normalized} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v) => formatUsd(v)}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={70}
        />
        <Tooltip
          formatter={(value) => [formatUsd(Number(value)), "PNL"]}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          }
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={lineColor}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
