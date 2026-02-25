#!/usr/bin/env npx tsx
/**
 * AnyPredict Multi-Metric Strategy Backtest
 * ==========================================
 *
 * Tests the forecast edge trading strategy across all Climate & Science metrics:
 *   - Temperature (Open-Meteo Archive)
 *   - Snowfall (Open-Meteo Archive)
 *   - Rainfall (Open-Meteo Archive)
 *   - Wind Speed (Open-Meteo Archive)
 *   - Earthquake (USGS Historical)
 *
 * WHAT'S REAL:
 *   - Actual historical values (Open-Meteo Archive / USGS)
 *   - Market bucket structure (matches Polymarket format)
 *   - Strategy logic (same algorithms as the app)
 *
 * WHAT'S SIMULATED:
 *   - Ensemble forecasts: actual + calibrated noise per metric
 *   - Market prices: Two scenarios (climatological & noisy forecast)
 *   - Earthquake ensemble: Poisson frequency model from 20yr USGS history
 *
 * RUN: npx tsx scripts/backtest.ts
 * RUN SINGLE: npx tsx scripts/backtest.ts --metric temperature
 */

import { runStrategyBacktest, METRIC_PROFILES } from "../src/lib/backtest-engine";
import type { BacktestOutput, ScenarioResult, StrategyBacktestConfig } from "../src/lib/types";
import type { WeatherMetric } from "../src/lib/weather-config";

// ═══════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════

const ALL_METRICS: WeatherMetric[] = [
  "temperature",
  "snowfall",
  "rainfall",
  "wind_speed",
  "earthquake_magnitude",
];

const METRIC_ICONS: Record<string, string> = {
  temperature: "🌡️",
  snowfall: "❄️",
  rainfall: "🌧️",
  wind_speed: "🌪️",
  earthquake_magnitude: "🌍",
};

// ═══════════════════════════════════════════════════════════
// CLI argument parsing
// ═══════════════════════════════════════════════════════════

function parseArgs(): { metrics: WeatherMetric[] } {
  const args = process.argv.slice(2);
  const metricIdx = args.indexOf("--metric");
  if (metricIdx !== -1 && args[metricIdx + 1]) {
    const m = args[metricIdx + 1] as WeatherMetric;
    if (ALL_METRICS.includes(m)) {
      return { metrics: [m] };
    }
    console.error(`Unknown metric: ${m}. Available: ${ALL_METRICS.join(", ")}`);
    process.exit(1);
  }
  return { metrics: ALL_METRICS };
}

// ═══════════════════════════════════════════════════════════
// Report printing
// ═══════════════════════════════════════════════════════════

function printHeader(config: StrategyBacktestConfig) {
  const profile = METRIC_PROFILES[config.metric as WeatherMetric] ?? METRIC_PROFILES.temperature;
  const icon = METRIC_ICONS[config.metric ?? "temperature"] ?? "📊";
  console.log();
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log(`║  ${icon} ${profile.label.toUpperCase().padEnd(56)}║`);
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  Period:    ${config.start} → ${config.end}`);
  console.log(`  Locations: ${config.cities.join(", ")}`);
  console.log(`  Unit:      ${config.unit ?? profile.primaryUnit}`);
  console.log(`  Strategy:  ${config.minEdge * 100}% min edge, ${config.feeBps}bp fees + ${config.slippageBps}bp slippage`);
  console.log(`  Base size: $${config.baseSize}, half-Kelly × ${config.confidence}% confidence`);
}

function printScenario(scenario: ScenarioResult) {
  const m = scenario.metrics;
  console.log();
  console.log(`┌─ ${scenario.name}`);
  console.log(`│  ${scenario.description}`);
  console.log("│");

  if (m.totalTrades === 0) {
    console.log("│  No trades executed.");
    console.log("└");
    return;
  }

  const pSign = m.totalPnl >= 0 ? "+" : "";
  const avgSign = m.avgPnlPerTrade >= 0 ? "+" : "";

  console.log(`│  📊 HEADLINE METRICS`);
  console.log(`│`);
  console.log(`│  Total P&L:       ${pSign}$${m.totalPnl.toFixed(2)}`);
  console.log(`│  Total Invested:  $${m.totalInvested.toFixed(2)}`);
  console.log(`│  ROI:             ${m.roi.toFixed(1)}%`);
  console.log(`│  Win Rate:        ${m.winRate.toFixed(1)}% (${m.wins}W / ${m.losses}L out of ${m.totalTrades} trades)`);
  console.log(`│  Avg Edge:        ${m.avgEdge.toFixed(1)}%`);
  console.log(`│  Avg Trade P&L:   ${avgSign}$${m.avgPnlPerTrade.toFixed(2)}`);
  console.log(`│`);
  console.log(`│  📈 RISK METRICS`);
  console.log(`│`);
  console.log(`│  Sharpe Ratio:    ${m.sharpe.toFixed(2)} (annualized)`);
  console.log(`│  Max Drawdown:    -$${m.maxDrawdown.toFixed(2)}`);
  console.log(`│  Longest Losing:  ${m.longestLosingStreak} trades`);
  console.log(`│  Profit Factor:   ${m.profitFactor >= 999 ? "∞" : m.profitFactor.toFixed(2)}`);
  console.log(`│`);
  console.log(`│  🏆 NOTABLE TRADES`);
  console.log(`│`);
  console.log(`│  Best:  +$${m.bestTrade.pnl.toFixed(2)} (${m.bestTrade.city}, ${m.bestTrade.date}, ${m.bestTrade.side} ${m.bestTrade.bucket})`);
  console.log(`│  Worst: -$${Math.abs(m.worstTrade.pnl).toFixed(2)} (${m.worstTrade.city}, ${m.worstTrade.date}, ${m.worstTrade.side} ${m.worstTrade.bucket})`);
  console.log("└");
}

function printCityBreakdown(scenario: ScenarioResult) {
  console.log(`  ${scenario.name} — Per-Location Breakdown:`);
  for (const c of scenario.cityBreakdown) {
    const pSign = c.pnl >= 0 ? "+" : "";
    console.log(`    ${c.city.padEnd(20)} ${pSign}$${c.pnl.toFixed(2).padStart(8)}  (${c.winRate.toFixed(0)}% WR, ${c.trades} trades)`);
  }
}

function printMonthlyBreakdown(scenario: ScenarioResult) {
  console.log(`  ${scenario.name}:`);
  console.log("  Month      P&L        WR      Trades  Cumulative");
  console.log("  ─────      ───        ──      ──────  ──────────");
  for (const mp of scenario.monthlyPnl) {
    const pSign = mp.pnl >= 0 ? "+" : "";
    const cSign = mp.cumulative >= 0 ? "+" : "";
    console.log(
      `  ${mp.month}   ${pSign}$${mp.pnl.toFixed(2).padStart(8)}   ${mp.winRate.toFixed(0).padStart(3)}%     ${String(mp.trades).padStart(4)}    ${cSign}$${mp.cumulative.toFixed(2)}`
    );
  }
}

function printCalibration(scenario: ScenarioResult) {
  if (scenario.calibration.length === 0) {
    console.log("  (Insufficient data for calibration)");
    return;
  }
  console.log("  Predicted    Actual     Count  Calibration");
  console.log("  ─────────    ──────     ─────  ───────────");
  for (const cb of scenario.calibration) {
    const diff = cb.actual - cb.predicted;
    const calLabel = Math.abs(diff) < 5 ? "✓ Good" :
      Math.abs(diff) < 10 ? "~ Fair" : "✗ Off";
    console.log(
      `  ${cb.label.padEnd(10)}   ${String(cb.actual).padStart(3)}%      ${String(cb.count).padStart(4)}   ${calLabel} (${diff > 0 ? "+" : ""}${diff}%)`
    );
  }
}

function printTradeTypes(scenario: ScenarioResult) {
  console.log(`  ${scenario.name}:`);
  for (const tt of scenario.tradeTypeBreakdown) {
    if (tt.trades === 0) {
      console.log(`  ${tt.side.padEnd(8)} — No trades`);
      continue;
    }
    const pSign = tt.pnl >= 0 ? "+" : "";
    console.log(
      `  ${tt.side.padEnd(8)} ${String(tt.trades).padStart(4)} trades  ${pSign}$${tt.pnl.toFixed(2).padStart(8)}   ${tt.winRate.toFixed(0)}% WR   avg edge ${tt.avgEdge.toFixed(1)}%`
    );
  }
}

// ═══════════════════════════════════════════════════════════
// Cross-metric summary
// ═══════════════════════════════════════════════════════════

interface MetricSummary {
  metric: string;
  icon: string;
  totalPnl: number;
  roi: number;
  winRate: number;
  sharpe: number;
  trades: number;
  scenario: string;
}

function printCrossMetricSummary(summaries: MetricSummary[]) {
  console.log();
  console.log("━".repeat(70));
  console.log("                  CROSS-METRIC SUMMARY");
  console.log("━".repeat(70));
  console.log();
  console.log("  Metric             Scenario              P&L       ROI    WR    Sharpe  Trades");
  console.log("  ──────             ────────              ───       ───    ──    ──────  ──────");

  for (const s of summaries) {
    const pSign = s.totalPnl >= 0 ? "+" : "";
    console.log(
      `  ${s.icon} ${s.metric.padEnd(18)} ${s.scenario.padEnd(20)} ${pSign}$${s.totalPnl.toFixed(2).padStart(8)}  ${s.roi.toFixed(1).padStart(5)}%  ${s.winRate.toFixed(0).padStart(3)}%   ${s.sharpe.toFixed(2).padStart(5)}   ${String(s.trades).padStart(5)}`
    );
  }

  const totalPnl = summaries.reduce((s, r) => s + r.totalPnl, 0);
  const totalTrades = summaries.reduce((s, r) => s + r.trades, 0);
  console.log("  " + "─".repeat(90));
  const tSign = totalPnl >= 0 ? "+" : "";
  console.log(`  TOTAL${" ".repeat(47)} ${tSign}$${totalPnl.toFixed(2).padStart(8)}${" ".repeat(22)}${String(totalTrades).padStart(5)}`);
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

async function main() {
  const { metrics } = parseArgs();

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           AnyPredict Multi-Metric Strategy Backtest          ║");
  console.log("║           Climate & Science Forecast Edge Trading            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Metrics to test: ${metrics.map((m) => `${METRIC_ICONS[m]} ${METRIC_PROFILES[m].label}`).join(", ")}`);

  const allSummaries: MetricSummary[] = [];
  const allResults: Map<string, BacktestOutput> = new Map();

  for (const metric of metrics) {
    const profile = METRIC_PROFILES[metric];
    console.log();
    console.log("━".repeat(70));
    console.log(`  Fetching ${profile.label} data...`);

    const output = await runStrategyBacktest({ metric });
    allResults.set(metric, output);

    // Print per-metric report
    printHeader(output.config);

    for (const scenario of output.scenarios) {
      printScenario(scenario);

      // Collect summary
      allSummaries.push({
        metric: profile.label,
        icon: METRIC_ICONS[metric],
        totalPnl: scenario.metrics.totalPnl,
        roi: scenario.metrics.roi,
        winRate: scenario.metrics.winRate,
        sharpe: scenario.metrics.sharpe,
        trades: scenario.metrics.totalTrades,
        scenario: scenario.name,
      });
    }

    // Per-location breakdown
    console.log();
    console.log("  🏙️  PER-LOCATION BREAKDOWN");
    for (const scenario of output.scenarios) {
      printCityBreakdown(scenario);
    }

    // Monthly breakdown
    console.log();
    console.log("  📅 MONTHLY P&L");
    for (const scenario of output.scenarios) {
      printMonthlyBreakdown(scenario);
    }

    // Calibration (use last scenario)
    const calScenario = output.scenarios[output.scenarios.length - 1];
    if (calScenario) {
      console.log();
      console.log("  📐 CALIBRATION ANALYSIS");
      printCalibration(calScenario);
    }

    // Trade type analysis
    console.log();
    console.log("  🔄 TRADE TYPE ANALYSIS");
    for (const scenario of output.scenarios) {
      printTradeTypes(scenario);
    }
  }

  // Cross-metric summary
  if (metrics.length > 1) {
    printCrossMetricSummary(allSummaries);
  }

  // Methodology
  console.log();
  console.log("━".repeat(70));
  console.log("                        METHODOLOGY");
  console.log("━".repeat(70));
  console.log();
  console.log("  Real data:");
  console.log("    • Actual daily values from Open-Meteo Archive API / USGS API");
  console.log("    • Climatology from 2019-2024 (5 years of historical data)");
  console.log("    • Earthquake history from USGS (20-year lookback, 250km radius)");
  console.log();
  console.log("  Simulated components:");
  console.log("    • Weather ensemble: actual + calibrated noise (metric-specific σ)");
  console.log("    • Earthquake ensemble: Poisson frequency model (1000 synthetic members)");
  console.log("    • Market prices: Two scenarios (climatological & noisy forecast)");
  console.log();
  console.log("  Limitations:");
  console.log("    • No real Polymarket prices (market efficiency is simulated)");
  console.log("    • Ensemble members are synthetic (not actual NWP model runs)");
  console.log("    • Assumes sufficient liquidity to execute at simulated prices");
  console.log("    • Results will vary slightly between runs (Monte Carlo)");
  console.log();
}

main().catch((err) => {
  console.error("Backtest failed:", err);
  process.exit(1);
});
