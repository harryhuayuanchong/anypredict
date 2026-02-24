"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  LineChart,
  Line,
  Legend,
  Area,
  ComposedChart,
} from "recharts";

/* ─── Forecast vs Actual Temperature ─── */
export function ForecastVsActualChart({
  forecastTemps,
  forecastTimes,
  actualTemps,
  actualTimes,
  thresholdLow,
  thresholdHigh,
}: {
  forecastTemps: number[];
  forecastTimes: string[];
  actualTemps?: number[];
  actualTimes?: string[];
  thresholdLow?: number | null;
  thresholdHigh?: number | null;
}) {
  // Merge forecast and actual into one dataset keyed by hour
  const dataMap = new Map<string, { hour: string; forecast?: number; actual?: number }>();

  forecastTimes.forEach((t, i) => {
    const hour = t.replace(/T/, " ").slice(5, 16); // "MM-DD HH:MM"
    dataMap.set(t, { hour, forecast: forecastTemps[i] });
  });

  if (actualTemps && actualTimes) {
    actualTimes.forEach((t, i) => {
      const hour = t.replace(/T/, " ").slice(5, 16);
      const existing = dataMap.get(t);
      if (existing) {
        existing.actual = actualTemps[i];
      } else {
        dataMap.set(t, { hour, actual: actualTemps[i] });
      }
    });
  }

  const data = Array.from(dataMap.values()).sort((a, b) =>
    a.hour.localeCompare(b.hour)
  );

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 10 }}
          interval={Math.max(0, Math.floor(data.length / 8) - 1)}
        />
        <YAxis tick={{ fontSize: 11 }} unit="°C" />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          formatter={(v: unknown) => `${Number(v).toFixed(1)}°C`}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke="#6366f1"
          strokeWidth={2}
          dot={false}
          name="Forecast"
        />
        {actualTemps && (
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            name="Actual"
          />
        )}
        {thresholdHigh != null && (
          <ReferenceLine
            y={thresholdHigh}
            stroke="#ef4444"
            strokeDasharray="5 5"
            label={{ value: `${thresholdHigh}°C`, position: "right", fontSize: 10 }}
          />
        )}
        {thresholdLow != null && (
          <ReferenceLine
            y={thresholdLow}
            stroke="#ef4444"
            strokeDasharray="5 5"
            label={{ value: `${thresholdLow}°C`, position: "right", fontSize: 10 }}
          />
        )}
        {/* Shade the threshold zone for range markets */}
        {thresholdLow != null && thresholdHigh != null && (
          <Area
            type="monotone"
            dataKey={() => thresholdHigh}
            fill="#ef444420"
            stroke="none"
            baseValue={thresholdLow}
            name=""
            legendType="none"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ─── P&L Waterfall (for runs list) ─── */
export function PnlWaterfallChart({
  runs,
}: {
  runs: { id: string; title: string; pnl: number; date: string }[];
}) {
  let cumulative = 0;
  const data = runs.map((r) => {
    cumulative += r.pnl;
    return {
      name: r.title.length > 20 ? r.title.slice(0, 20) + "..." : r.title,
      pnl: r.pnl,
      cumulative: Math.round(cumulative * 100) / 100,
      date: r.date,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 11 }} unit="$" />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          formatter={(v: unknown, name: unknown) => [
            `$${Number(v).toFixed(2)}`,
            String(name) === "pnl" ? "Run P&L" : "Cumulative",
          ]}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="pnl" name="Run P&L" radius={[2, 2, 0, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"}
            />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke="#6366f1"
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Cumulative P&L"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ─── Model Accuracy (predicted prob vs outcome) ─── */
export function EdgeAccuracyChart({
  runs,
}: {
  runs: {
    title: string;
    model_prob: number;
    market_prob: number;
    resolved_yes: boolean;
    date: string;
  }[];
}) {
  const data = runs.map((r) => ({
    date: r.date,
    model: Math.round(r.model_prob * 100),
    market: Math.round(r.market_prob * 100),
    outcome: r.resolved_yes ? 100 : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          formatter={(v: unknown, name: unknown) => [`${Number(v)}%`, String(name)]}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="model" stroke="#6366f1" strokeWidth={2} name="Model Prob" dot={{ r: 3 }} />
        <Line type="monotone" dataKey="market" stroke="#a3a3a3" strokeWidth={1.5} strokeDasharray="5 5" name="Market Prob" dot={{ r: 2 }} />
        <Line type="stepAfter" dataKey="outcome" stroke="#f97316" strokeWidth={1.5} name="Outcome (0/100)" dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ─── Forecast Error Distribution ─── */
export function ForecastErrorChart({
  errors,
}: {
  errors: { range: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={errors} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="range" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} name="Runs" />
      </BarChart>
    </ResponsiveContainer>
  );
}
