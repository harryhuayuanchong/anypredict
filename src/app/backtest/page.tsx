import type { Metadata } from "next";
import { BacktestClient } from "./backtest-client";

export const metadata: Metadata = {
  title: "Strategy Backtest | AnyPredict",
  description: "Historical backtest of the weather forecast edge trading strategy",
};

export default function BacktestPage() {
  return <BacktestClient />;
}
