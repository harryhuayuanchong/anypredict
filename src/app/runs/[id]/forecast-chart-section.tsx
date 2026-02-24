"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForecastVsActualChart } from "@/components/charts";

interface Props {
  forecastTemps: number[];
  forecastTimes: string[];
  thresholdLow: number | null;
  thresholdHigh: number | null;
  forecastTemp: number;
  targetTime: string;
}

export function ForecastChartSection({
  forecastTemps,
  forecastTimes,
  thresholdLow,
  thresholdHigh,
  forecastTemp,
  targetTime,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Temperature Forecast
          <span className="text-xs font-normal text-muted-foreground ml-2">
            Target: {forecastTemp}°C at {targetTime}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ForecastVsActualChart
          forecastTemps={forecastTemps}
          forecastTimes={forecastTimes}
          thresholdLow={thresholdLow}
          thresholdHigh={thresholdHigh}
        />
      </CardContent>
    </Card>
  );
}
