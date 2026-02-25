/**
 * Centralized weather variable configuration
 * Single source of truth for all weather metric types
 */

export type WeatherMetric =
  | "temperature"
  | "snowfall"
  | "rainfall"
  | "wind_speed"
  | "earthquake_magnitude"
  | "climate_anomaly";

export type WeatherCategory =
  | "Temperature"
  | "Snow"
  | "Rain"
  | "Storm"
  | "Earthquake"
  | "Climate"
  | "ClimateAnomaly"
  | "Weather";

export interface WeatherVariableConfig {
  metric: WeatherMetric;
  category: WeatherCategory;

  // Open-Meteo API variables
  forecastHourlyVar: string; // for deterministic forecast
  forecastDailyVar: string | null; // for daily aggregation
  ensembleDailyVar: string; // for ensemble API
  archiveDailyVar: string; // for historical/backtest
  archiveHourlyVar: string | null;
  ensembleMemberPrefix: string; // key prefix for _member01, _member02, etc.

  // Units & display
  primaryUnit: string; // "°C", "cm", "mm", "km/h", "M"
  secondaryUnit: string | null; // "°F", "in", "mph", null
  primaryToSecondary: ((val: number) => number) | null;
  secondaryToPrimary: ((val: number) => number) | null;

  // Defaults
  defaultSigma: number;
  sigmaLabel: string;

  // How to aggregate hourly → daily
  dailyAggregation: "max" | "sum" | "mean";

  // Data provider
  dataSource: "open-meteo" | "usgs" | "nasa-giss";

  // Whether this metric uses a specific location (false = global index)
  requiresLocation: boolean;
}

export const WEATHER_CONFIGS: Record<WeatherMetric, WeatherVariableConfig> = {
  temperature: {
    metric: "temperature",
    category: "Temperature",
    forecastHourlyVar: "temperature_2m",
    forecastDailyVar: null,
    ensembleDailyVar: "temperature_2m_max",
    archiveDailyVar: "temperature_2m_max",
    archiveHourlyVar: "temperature_2m",
    ensembleMemberPrefix: "temperature_2m_max",
    primaryUnit: "°C",
    secondaryUnit: "°F",
    primaryToSecondary: (c) => Math.round((c * 9) / 5 + 32),
    secondaryToPrimary: (f) =>
      Math.round((((f - 32) * 5) / 9) * 10) / 10,
    defaultSigma: 1.5,
    sigmaLabel: "σ Temperature (°C)",
    dailyAggregation: "max",
    dataSource: "open-meteo",
    requiresLocation: true,
  },
  snowfall: {
    metric: "snowfall",
    category: "Snow",
    forecastHourlyVar: "snowfall",
    forecastDailyVar: "snowfall_sum",
    ensembleDailyVar: "snowfall_sum",
    archiveDailyVar: "snowfall_sum",
    archiveHourlyVar: "snowfall",
    ensembleMemberPrefix: "snowfall_sum",
    primaryUnit: "cm",
    secondaryUnit: "in",
    primaryToSecondary: (cm) => Math.round((cm / 2.54) * 10) / 10,
    secondaryToPrimary: (inches) =>
      Math.round(inches * 2.54 * 10) / 10,
    defaultSigma: 2.0,
    sigmaLabel: "σ Snowfall (cm)",
    dailyAggregation: "sum",
    dataSource: "open-meteo",
    requiresLocation: true,
  },
  rainfall: {
    metric: "rainfall",
    category: "Rain",
    forecastHourlyVar: "precipitation",
    forecastDailyVar: "precipitation_sum",
    ensembleDailyVar: "precipitation_sum",
    archiveDailyVar: "precipitation_sum",
    archiveHourlyVar: "precipitation",
    ensembleMemberPrefix: "precipitation_sum",
    primaryUnit: "mm",
    secondaryUnit: "in",
    primaryToSecondary: (mm) => Math.round((mm / 25.4) * 100) / 100,
    secondaryToPrimary: (inches) =>
      Math.round(inches * 25.4 * 10) / 10,
    defaultSigma: 5.0,
    sigmaLabel: "σ Rainfall (mm)",
    dailyAggregation: "sum",
    dataSource: "open-meteo",
    requiresLocation: true,
  },
  wind_speed: {
    metric: "wind_speed",
    category: "Storm",
    forecastHourlyVar: "wind_gusts_10m",
    forecastDailyVar: "wind_gusts_10m_max",
    ensembleDailyVar: "wind_gusts_10m_max",
    archiveDailyVar: "wind_gusts_10m_max",
    archiveHourlyVar: "wind_gusts_10m",
    ensembleMemberPrefix: "wind_gusts_10m_max",
    primaryUnit: "km/h",
    secondaryUnit: "mph",
    primaryToSecondary: (kmh) => Math.round(kmh * 0.621371 * 10) / 10,
    secondaryToPrimary: (mph) =>
      Math.round((mph / 0.621371) * 10) / 10,
    defaultSigma: 10.0,
    sigmaLabel: "σ Wind Gusts (km/h)",
    dailyAggregation: "max",
    dataSource: "open-meteo",
    requiresLocation: true,
  },
  earthquake_magnitude: {
    metric: "earthquake_magnitude",
    category: "Earthquake",
    forecastHourlyVar: "", // N/A — uses USGS
    forecastDailyVar: null,
    ensembleDailyVar: "",
    archiveDailyVar: "",
    archiveHourlyVar: null,
    ensembleMemberPrefix: "",
    primaryUnit: "M",
    secondaryUnit: null,
    primaryToSecondary: null,
    secondaryToPrimary: null,
    defaultSigma: 0.5,
    sigmaLabel: "σ Magnitude (Richter)",
    dailyAggregation: "max",
    dataSource: "usgs",
    requiresLocation: true,
  },
  climate_anomaly: {
    metric: "climate_anomaly",
    category: "ClimateAnomaly",
    forecastHourlyVar: "", // N/A — uses NASA GISS
    forecastDailyVar: null,
    ensembleDailyVar: "",
    archiveDailyVar: "",
    archiveHourlyVar: null,
    ensembleMemberPrefix: "",
    primaryUnit: "°C",
    secondaryUnit: null,
    primaryToSecondary: null,
    secondaryToPrimary: null,
    defaultSigma: 0.15,
    sigmaLabel: "σ Anomaly (°C)",
    dailyAggregation: "mean",
    dataSource: "nasa-giss",
    requiresLocation: false, // global index — no lat/lon needed
  },
};

/** Map from UI category → metric key */
export const CATEGORY_TO_METRIC: Record<string, WeatherMetric> = {
  Temperature: "temperature",
  Climate: "temperature", // Climate events are typically temperature-based
  ClimateAnomaly: "climate_anomaly", // NASA GISTEMP global index
  Snow: "snowfall",
  Rain: "rainfall",
  Storm: "wind_speed",
  Earthquake: "earthquake_magnitude",
  Weather: "temperature", // fallback
};

/** Get config from a detected category string */
export function getConfigForCategory(
  category: string
): WeatherVariableConfig {
  const metric = CATEGORY_TO_METRIC[category];
  return metric
    ? WEATHER_CONFIGS[metric]
    : WEATHER_CONFIGS.temperature;
}

/** Get config from a metric key */
export function getConfigForMetric(
  metric: string
): WeatherVariableConfig {
  return (
    WEATHER_CONFIGS[metric as WeatherMetric] ??
    WEATHER_CONFIGS.temperature
  );
}

/**
 * Detect weather category from event title.
 * Shared logic used by events route and extract route.
 */
export function detectCategory(title: string): WeatherCategory {
  const t = title.toLowerCase();

  // Climate anomaly / GISTEMP — must check BEFORE generic temperature
  if (
    t.includes("temperature increase") ||
    t.includes("temperature anomaly") ||
    t.includes("temperature decrease") ||
    t.includes("global temperature") ||
    t.includes("gistemp") ||
    t.includes("land-ocean temperature index") ||
    t.includes("global land-ocean")
  )
    return "ClimateAnomaly";

  if (t.includes("temperature") || t.includes("highest temp") || t.includes("lowest temp"))
    return "Temperature";
  if (t.includes("snow") || t.includes("snowfall"))
    return "Snow";
  if (t.includes("earthquake") || t.includes("seismic"))
    return "Earthquake";
  if (t.includes("hurricane") || t.includes("storm") || t.includes("cyclone") || t.includes("wind") || t.includes("tornado"))
    return "Storm";
  if (t.includes("rain") || t.includes("precipitation"))
    return "Rain";
  if (t.includes("hottest") || t.includes("warmest") || t.includes("coldest"))
    return "Climate";
  return "Weather";
}
