## Resolution Rule Types

All Climate & Science markets use one of two rule types:
- **`above_below`** — market resolves based on whether a value is above or below a single threshold
- **`range`** — market resolves based on whether a value falls within a range (low–high)

---

## Categories, Resolution Rules & Datasources

| Category | Metric | Unit | Datasource | Rule Patterns (parsed from question text) |
|---|---|---|---|---|
| **Temperature** | `temperature` | °C / °F | **Open-Meteo** (forecast: `temperature_2m`, ensemble: `temperature_2m_max`, archive: `temperature_2m_max`) | "X°F or above/below", "X–Y°F" |
| **Climate** | `temperature` | °C / °F | **Open-Meteo** (same as Temperature) | Detected by keywords "hottest", "warmest", "coldest" — same parsing as Temperature |
| **Snow** | `snowfall` | cm / in | **Open-Meteo** (forecast: `snowfall`, ensemble: `snowfall_sum`, archive: `snowfall_sum`) | "X inches or more", "less than X inches", "X–Y inches" |
| **Rain** | `rainfall` | mm / in | **Open-Meteo** (forecast: `precipitation`, ensemble: `precipitation_sum`, archive: `precipitation_sum`) | "more than X mm", "less than X mm", "X–Y mm" |
| **Storm** | `wind_speed` | km/h / mph | **Open-Meteo** (forecast: `wind_gusts_10m`, ensemble: `wind_gusts_10m_max`, archive: `wind_gusts_10m_max`) | "X mph or more", "winds above X mph", "gusts over X km/h", "X–Y mph" |
| **Earthquake** | `earthquake_magnitude` | M (Richter) | **USGS** (historical earthquake catalog, 20-year lookback, Poisson-based synthetic ensemble) | "magnitude X or greater", "X+ earthquake", "magnitude below X", "between X and Y" |
| **Weather** (fallback) | `temperature` | °C / °F | **Open-Meteo** | Falls through all parsers if category is unknown |

---

## Datasource Details

### 1. Open-Meteo (Temperature, Climate, Snow, Rain, Storm, Weather)
- **Forecast API** — deterministic point forecasts (e.g. `temperature_2m`, `snowfall`, `precipitation`, `wind_gusts_10m`)
- **Ensemble API** — probabilistic ensemble members (e.g. `temperature_2m_max`, `snowfall_sum`, `precipitation_sum`, `wind_gusts_10m_max`)
- **Archive API** — historical data for backtesting (same variables as ensemble)
- Location: identified by **city** → geocoded to lat/lon

### 2. USGS (Earthquake)
- Fetches historical earthquake events within a **search radius** (default 250 km)
- 20-year lookback, minimum magnitude 2.0
- Builds **1000 synthetic ensemble members** using Poisson frequency analysis + empirical magnitude distribution
- Location: identified by **region/epicenter** (e.g. "California")

---

## Key Config Files
- **`src/lib/weather-config.ts`** — metric definitions, category detection, category→metric mapping
- **`src/lib/polymarket.ts`** — resolution rule parsers (one per metric + unified dispatcher)
- **`src/lib/earthquake.ts`** — USGS data pipeline
- **`src/lib/types.ts`** — `WeatherStrategyRun` interface with `rule_type`, `threshold_low/high`, `weather_metric`, `weather_unit`
