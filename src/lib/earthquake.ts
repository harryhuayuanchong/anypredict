/**
 * Earthquake data via USGS FDSNWS API
 * Uses historical frequency analysis + synthetic ensemble
 * to produce probabilities compatible with the existing compute pipeline.
 */

import type {
  PreFetchedWeatherData,
  ForecastSnapshot,
  MultiModelResult,
} from "./types";

const USGS_API = "https://earthquake.usgs.gov/fdsnws/event/1/query";

export interface EarthquakeEvent {
  magnitude: number;
  place: string;
  time: number; // unix ms
  lat: number;
  lon: number;
  depth: number;
}

/**
 * Fetch historical earthquake events from USGS within a radius.
 * Defaults to 250 km radius and 20-year lookback.
 */
export async function fetchHistoricalEarthquakes(
  lat: number,
  lon: number,
  radiusKm: number = 250,
  lookbackYears: number = 20
): Promise<EarthquakeEvent[]> {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - lookbackYears);

  const url = new URL(USGS_API);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("maxradiuskm", radiusKm.toString());
  url.searchParams.set("starttime", start.toISOString().split("T")[0]);
  url.searchParams.set("endtime", end.toISOString().split("T")[0]);
  url.searchParams.set("minmagnitude", "2.0");
  url.searchParams.set("orderby", "time-asc");
  url.searchParams.set("limit", "20000");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`USGS API error: ${res.status} for ${url.toString()}`);

  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.features || []).map((f: any) => ({
    magnitude: f.properties.mag,
    place: f.properties.place,
    time: f.properties.time,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    depth: f.geometry.coordinates[2],
  }));
}

/**
 * Build synthetic ensemble from historical earthquake frequency.
 *
 * Approach:
 * - Compute historical daily rate of earthquakes in the region
 * - For each synthetic "member", sample the number of events from Poisson(rate * windowDays)
 * - Sample magnitudes from the empirical distribution
 * - Each member value = max magnitude in that window (or 0 if no events)
 *
 * This produces an array that can be fed directly into ensembleProbability().
 */
export function buildEarthquakeEnsemble(
  events: EarthquakeEvent[],
  lookbackYears: number = 20,
  windowDays: number = 7,
  syntheticMembers: number = 1000
): number[] {
  const magnitudes = events.map((e) => e.magnitude).filter((m) => m > 0);

  if (magnitudes.length < 5) {
    // Very low seismicity region — mostly zeros
    return Array.from({ length: syntheticMembers }, () =>
      Math.random() < 0.005 ? 2.0 + Math.random() * 4.0 : 0
    );
  }

  // Compute daily event rate
  const totalDays = lookbackYears * 365.25;
  const dailyRate = magnitudes.length / totalDays;
  const windowRate = dailyRate * windowDays;

  const members: number[] = [];
  for (let i = 0; i < syntheticMembers; i++) {
    const nEvents = poissonSample(windowRate);
    if (nEvents === 0) {
      members.push(0);
    } else {
      // Sample magnitudes from empirical distribution
      const sampled = Array.from(
        { length: nEvents },
        () => magnitudes[Math.floor(Math.random() * magnitudes.length)]
      );
      members.push(Math.max(...sampled));
    }
  }

  return members;
}

/** Poisson random variate via inverse CDF method */
function poissonSample(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

/**
 * Fetch earthquake data packaged as PreFetchedWeatherData
 * so it integrates seamlessly with the existing compute pipeline.
 */
export async function fetchEarthquakeData(
  lat: number,
  lon: number,
  resolutionTime: string,
  radiusKm: number = 250,
  windowDays: number = 7
): Promise<PreFetchedWeatherData> {
  const events = await fetchHistoricalEarthquakes(lat, lon, radiusKm);
  const ensemble = buildEarthquakeEnsemble(events, 20, windowDays);

  const mean =
    ensemble.length > 0
      ? ensemble.reduce((a, b) => a + b, 0) / ensemble.length
      : 0;

  const sorted = [...ensemble].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;

  const variance =
    ensemble.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
    (ensemble.length - 1 || 1);
  const stdDev = Math.sqrt(variance);

  const forecast: ForecastSnapshot = {
    latitude: lat,
    longitude: lon,
    timezone: "UTC",
    hourly_times: [],
    hourly_temps: [],
    target_time: resolutionTime,
    forecast_temp: mean,
    forecast_temp_min: null,
    forecast_temp_max: null,
    forecast_value: mean,
    hourly_values: null,
    weather_metric: "earthquake_magnitude",

    // Ensemble fields
    ensemble_members: ensemble,
    ensemble_p10: p10,
    ensemble_p50: p50,
    ensemble_p90: p90,
    ensemble_std: stdDev,
    ensemble_model: "usgs_historical_frequency",
    ensemble_member_count: ensemble.length,
    prob_method: "ensemble",
    ensemble_models: [
      {
        model: "usgs_historical_frequency",
        members: ensemble,
        member_count: ensemble.length,
        p10,
        p50,
        p90,
        std: stdDev,
        prob: 0, // filled by compute
      },
    ],
    models_agree: true,
  };

  const multiModel: MultiModelResult = {
    pooled_members: ensemble,
    per_model: [
      {
        members: ensemble,
        model: "usgs_historical_frequency",
        member_count: ensemble.length,
      },
    ],
    total_members: ensemble.length,
    models_label: "USGS Historical Frequency",
  };

  return {
    forecast,
    multiModel,
    targetDate: resolutionTime.split("T")[0],
  };
}
