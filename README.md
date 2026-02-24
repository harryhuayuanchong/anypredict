# AnyPredict

Prediction market analysis platform. Evaluate markets on [Polymarket](https://polymarket.com) using multi-model weather forecast ensembles, compute probabilistic edges, generate trade plans with Kelly sizing, and backtest against actual outcomes.

Currently supports **weather markets**, with geopolitics, sports, and politics coming soon.

---

## Table of Contents

- [Strategy](#strategy)
- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Key Algorithms](#key-algorithms)
- [Pages & Routes](#pages--routes)
- [API Routes](#api-routes)
- [Library Modules](#library-modules)
- [Database Schema](#database-schema)
- [External APIs](#external-apis)
- [Visualizations](#visualizations)
- [Setup](#setup)
- [Tech Stack](#tech-stack)

---

## Strategy

### Weather Forecast Edge Trading on Polymarket

AnyPredict runs a **quantitative edge-detection strategy** for binary weather prediction markets. The core thesis: *we have better weather forecasts than the average Polymarket trader.*

### The Setup

Polymarket lists weather events like *"What will be the highest temperature in NYC on Feb 24?"* with multiple sub-markets (temperature buckets): "25°F or below", "26-27°F", "28-29°F", ..., "40°F or higher". Each bucket trades as a binary YES/NO contract where the YES price reflects the crowd's implied probability.

### How the Strategy Finds Edge

**1. Build a Superior Probability Model**

The system fetches **~82 ensemble members** from two independent numerical weather prediction models — ECMWF IFS (51 members) and GFS (31 members). Each member is a slightly perturbed simulation of the atmosphere, producing a different daily max temperature prediction for the target date.

For a market like "40°F or higher", the system counts how many of the 82 members produce a daily max >= 40°F, with Laplace smoothing:

```
model_prob = (members_above_40F + 1) / (82 + 2)
```

This is an **empirical probability** from real forecast distributions — no Gaussian assumptions. If 70 out of 82 members say >= 40°F, that's ~84.5% true probability.

**2. Compare Model vs. Market**

The market's implied probability is simply the YES price (YES at 72¢ = market thinks 72% chance). The edge is:

```
edge = model_prob - market_implied_prob - fees - slippage
```

- **Positive edge** → Model says YES is more likely than the market thinks → **BUY YES**
- **Negative edge** → Model says YES is less likely → **BUY NO**
- **Small edge** → Not enough signal → **NO TRADE**

**3. Size with Kelly Criterion**

Once an edge is found, the [Kelly Criterion](https://en.wikipedia.org/wiki/Kelly_criterion) determines the mathematically optimal bet size. The system uses **half-Kelly** (50% of optimal) for conservative risk management, further scaled by a user confidence parameter:

```
suggested_size = bankroll × kelly_fraction × 0.5 × (confidence / 100)
```

**4. Scan All Markets, Pick the Best**

For an event with 15+ temperature buckets, the strategy analyzes **all of them at once** against the same weather data (fetched once). This reveals the single best trade — typically a **BUY NO on a tail bucket** where the crowd is overpricing an unlikely extreme outcome.

A conviction score (0-100%) ranks opportunities by combining edge strength, Kelly fraction, model agreement (do ECMWF and GFS agree?), ensemble spread, and probability method quality.

**5. Validate with Backtesting**

After market resolution, the system fetches actual observed temperatures and computes realized P&L to measure real strategy performance over time.

### Where the Alpha Lives

The most common profitable pattern is **BUY NO on tail temperature buckets**. Prediction market participants tend to overprice extreme weather outcomes (very hot or very cold), while the ensemble models correctly assign low probability to these tails. The strategy systematically harvests this behavioral bias.

### What This Strategy Is NOT

- **Not** momentum, technical analysis, or market-making
- **Not** factoring order book depth or market microstructure
- **Not** a black box — every trade has transparent rationale, assumptions, and invalidation conditions
- Currently **weather-only** (temperature markets), with the architecture designed to extend to other prediction market domains

---

## Features

- **One-Click Market Extraction** — Paste a Polymarket URL to auto-extract event metadata, all sub-markets, temperature thresholds, and live prices via the Gamma API
- **Batch Analysis** — Analyze ALL sub-markets for an event at once (e.g., 15+ temperature buckets). Weather data is fetched once; probabilities computed for each market
- **Multi-Model Ensemble** — Pools ~82 ensemble members from ECMWF IFS (51) and GFS (31) for empirical probability estimation with Laplace smoothing
- **Edge & Kelly Sizing** — Computes model probability vs. market-implied probability, calculates edge after fees/slippage, and generates half-Kelly position sizes scaled by user confidence
- **Conviction Scoring** — 0-100% composite score from 5 weighted signals: edge strength, Kelly fraction, model agreement, ensemble spread, and probability method
- **Trade Decision Cards** — Actionable "Buy NO at X¢ for $Y" recommendations with quick reasoning and key risk callouts
- **AI Summary** — Optional OpenAI-powered analysis with structured risk cards, highlighted numbers (percentages, dollars, temperatures), and verdict callouts
- **Backtesting** — Fetch actual temperatures from Open-Meteo Archive after market resolution, compute P&L with fee deductions
- **Performance Dashboard** — Aggregate stats across all runs: total P&L, win rate, Sharpe ratio, max drawdown, average edge
- **Events Discovery** — Browse live Polymarket weather events with grid/list views, category filters, and auto-refresh
- **Stale Price Handling** — Data age warnings, one-click price refresh that re-fetches from Polymarket and recomputes all edges

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS APP ROUTER                          │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  /events  │  │   /new    │  │  /runs   │  │ /runs/batch/[id]   │  │
│  │  Browse   │  │  Wizard   │  │Dashboard │  │  Comparison Table  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬───────────┘  │
│       │              │             │                  │              │
├───────┼──────────────┼─────────────┼──────────────────┼──────────────┤
│       │         API ROUTES         │                  │              │
│       ▼              ▼             ▼                  ▼              │
│  /api/events   /api/market    /api/runs/         /api/runs/         │
│               /extract       backtest           refresh-batch       │
│                    │                                  │              │
│                    ▼                                  ▼              │
│             /api/runs/compute-batch ◄────────────────┘              │
│                    │                                                │
└────────────────────┼────────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │Open-Meteo│ │Polymarket│ │ OpenAI   │
  │Forecast +│ │Gamma API │ │(optional)│
  │Ensemble +│ │          │ │          │
  │ Archive  │ │          │ │          │
  └──────────┘ └──────────┘ └──────────┘
        │            │            │
        └────────────┼────────────┘
                     ▼
              ┌──────────────┐
              │   Supabase   │
              │  (Postgres)  │
              └──────────────┘
```

**Three-layer design:**

1. **Data Ingestion** (`polymarket.ts` + `/api/market/extract`) — Parses Polymarket URLs, extracts event metadata, auto-detects city coordinates from a 50-city lookup, and parses temperature threshold rules from question text via regex.

2. **Computation Engine** (`compute.ts`) — The core. `fetchWeatherData()` makes 3 external calls (deterministic forecast + ECMWF ensemble + GFS ensemble), then `computeStrategyFromData()` runs pure synchronous logic — ensemble/normal probability, edge calculation, Kelly sizing, trade plan generation. Batch mode fetches weather once and runs N computations.

3. **Storage & Presentation** (Supabase + Next.js pages) — Results persisted as JSONB in a single Postgres table. Server components read directly from Supabase. Batch pages show comparison tables; single-run pages show full conviction analysis; the dashboard shows aggregate performance.

---

## Project Structure

```
anypredict/
├── supabase/
│   ├── migration.sql               # Initial schema
│   ├── migration_002_backtest.sql   # Adds backtest columns
│   └── migration_003_batch.sql     # Adds batch_id + event_slug
│
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with nav header
│   │   ├── page.tsx                # Redirects to /runs
│   │   ├── globals.css
│   │   │
│   │   ├── events/
│   │   │   └── page.tsx            # Browse live Polymarket events
│   │   │
│   │   ├── new/
│   │   │   └── page.tsx            # 3-step analysis wizard
│   │   │
│   │   ├── runs/
│   │   │   ├── page.tsx            # Runs list + performance dashboard
│   │   │   ├── runs-charts.tsx     # Client chart wrapper
│   │   │   ├── [id]/
│   │   │   │   ├── page.tsx                # Single run detail
│   │   │   │   ├── ai-summary-button.tsx   # AI summary trigger + animation
│   │   │   │   ├── ai-summary-content.tsx  # Rich markdown renderer
│   │   │   │   ├── backtest-section.tsx    # Backtest trigger + results
│   │   │   │   └── forecast-chart-section.tsx
│   │   │   └── batch/
│   │   │       └── [batchId]/
│   │   │           ├── page.tsx            # Batch comparison table
│   │   │           └── refresh-button.tsx  # Price refresh + recompute
│   │   │
│   │   └── api/
│   │       ├── ai/summary/route.ts         # POST: Generate AI summary
│   │       ├── events/route.ts             # GET: Browse Polymarket events
│   │       ├── market/extract/route.ts     # POST: Parse Polymarket URL
│   │       ├── weather/forecast/route.ts   # GET: Proxy to Open-Meteo
│   │       └── runs/
│   │           ├── compute/route.ts        # POST: Single market compute
│   │           ├── compute-batch/route.ts  # POST: Batch compute (all markets)
│   │           ├── backtest/route.ts       # POST: Fetch actuals + P&L
│   │           └── refresh-batch/route.ts  # POST: Refresh prices + recompute
│   │
│   ├── components/
│   │   ├── charts.tsx              # Recharts visualizations
│   │   └── ui/                     # shadcn/ui primitives
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── input.tsx
│   │       ├── label.tsx
│   │       ├── select.tsx
│   │       ├── separator.tsx
│   │       ├── table.tsx
│   │       ├── tabs.tsx
│   │       └── textarea.tsx
│   │
│   └── lib/
│       ├── compute.ts              # Weather fetch + probability + Kelly
│       ├── polymarket.ts           # URL parsing, city lookup, temp parsing
│       ├── supabase.ts             # Browser + server Supabase clients
│       ├── types.ts                # All TypeScript interfaces
│       └── utils.ts                # cn() classname helper
│
├── .env.example
├── package.json
├── next.config.ts
├── tsconfig.json
└── components.json
```

---

## How It Works

### End-to-End Data Flow

```
 1. PASTE URL                    2. EXTRACT                      3. CONFIGURE
 ┌──────────────┐    POST    ┌────────────────────┐          ┌────────────────┐
 │ User pastes   │──────────▶│ /api/market/extract │─────────▶│ Auto-filled    │
 │ Polymarket URL│           │                    │          │ form: location,│
 └──────────────┘           │ • extractSlug()     │          │ thresholds,    │
                            │ • Gamma API fetch   │          │ prices, config │
                            │ • extractCity()     │          └───────┬────────┘
                            │ • parseTemperature()│                  │
                            └────────────────────┘                  ▼
                                                            4. COMPUTE BATCH
                                                         ┌─────────────────────┐
                                                         │ /api/runs/           │
                                                         │   compute-batch      │
                                                         │                     │
                                                         │ • fetchWeatherData()│
                                                         │   (1 API call set)  │
                                                         │ • N × computeFrom  │
                                                         │   Data() (sync)     │
                                                         │ • Insert all to DB  │
                                                         └──────────┬──────────┘
                                                                    ▼
 6. BACKTEST                    5. COMPARE
 ┌──────────────────┐        ┌────────────────────────┐
 │ After resolution: │◀───────│ Batch comparison page:  │
 │ • Fetch actuals   │        │ • Ranked by edge        │
 │ • Resolve market  │        │ • Best BUY_YES/NO picks │
 │ • Calculate P&L   │        │ • Conviction scores     │
 │ • Update DB       │        │ • Trader's Verdict      │
 └──────────────────┘        └────────────────────────┘
```

### Step-by-Step

1. **Market Input** — Paste a Polymarket event URL (e.g., `polymarket.com/event/highest-temperature-in-nyc-on-feb-24`). The system calls the Gamma API to extract the event title, all sub-markets (temperature buckets like "26-27 F", "40 F or higher"), their current YES/NO prices, and auto-detects the city coordinates from a 50-city lookup table.

2. **Weather Config** — Configure forecast parameters: sigma (uncertainty for normal distribution fallback), time window (hours around resolution), and base position size. All sub-markets share the same location and date, so these settings apply to all.

3. **Batch Compute** — One API call fetches:
   - Deterministic forecast from Open-Meteo (hourly temperatures)
   - ECMWF IFS ensemble (51 members, daily max temperature)
   - GFS ensemble (31 members, daily max temperature)

   Then for each sub-market, the system computes probability, edge, Kelly fraction, and generates a trade plan — all synchronously with no additional API calls.

4. **Compare** — The batch comparison page ranks all sub-markets by edge, highlights the best BUY_YES and BUY_NO opportunities, shows a Trader's Verdict card with conviction scoring, and links to individual run details.

5. **Backtest** — After the market resolves, fetch the actual temperature from the Open-Meteo Historical Archive API, determine if YES or NO won, and calculate net P&L after fees and slippage.

---

## Key Algorithms

### Multi-Model Ensemble Probability

The primary probability method. Pools ensemble members from two weather models fetched in parallel:

| Model | Members | Source |
|-------|---------|--------|
| ECMWF IFS 0.25° | 51 (50 perturbed + 1 control) | `ensemble-api.open-meteo.com` |
| GFS 0.25° | 31 (30 perturbed + 1 control) | `ensemble-api.open-meteo.com` |
| **Total** | **~82 pooled members** | |

Each member provides a `temperature_2m_max` value for the target date. Probability is computed empirically with Laplace smoothing:

```
P(event) = (hits + 1) / (N + 2)
```

Where `hits` = number of members satisfying the market condition (e.g., temp >= 40°F).

Per-model probabilities are also computed individually. A `models_agree` flag indicates whether all models agree on the direction (both > 50% or both < 50%).

**Fallback**: When ensemble data is unavailable (< 5 members), falls back to a **Normal Distribution** method using the deterministic forecast as the mean and user-supplied `sigma_temp` as standard deviation, with an Abramowitz & Stegun CDF approximation.

### Edge Calculation

```
market_implied_prob = yes_price
edge = model_prob - market_implied_prob - (fee_bps + slippage_bps) / 10000

if edge > min_edge   → BUY_YES
if edge < -min_edge  → BUY_NO
otherwise            → NO_TRADE
```

### Kelly Criterion (Half-Kelly with Confidence Scaling)

For a binary market:

```
kelly_fraction = (model_prob - effective_price) / (1 - effective_price)
kelly_fraction = clamp(kelly_fraction, 0, 0.25)    // capped at 25%

kelly_size      = bankroll × kelly_fraction
half_kelly_size = kelly_size × 0.5
suggested_size  = half_kelly_size × (user_confidence / 100)
```

Half-Kelly is used by default for more conservative sizing. The user confidence parameter (0-100%) further scales the position.

### Conviction Score

A composite 0-100% score from 5 weighted signals:

| Signal | Weight | Formula |
|--------|--------|---------|
| Edge Strength | 35% | `min(abs(edge%) / 20, 1)` |
| Kelly Fraction | 20% | `min(kelly / 0.15, 1)` |
| Model Agreement | 15% | `agree=1.0, unknown=0.7, disagree=0.3` |
| Ensemble Spread | 15% | `max(0, 1 - std / 5)` |
| Prob Method | 15% | `ensemble=1.0, normal=0.6` |

Labels: **High** (>=75), **Medium** (>=45), **Low** (>=20), **None** (<20).

### Backtest P&L

```
BUY_YES at price P, size S:
  win  → gross = (1 - P) × S
  loss → gross = -P × S

BUY_NO at price (1-P), size S:
  win  → gross = P × S
  loss → gross = -(1 - P) × S

net_pnl = gross - fees
fees = (fee_bps + slippage_bps) / 10000 × S
```

---

## Pages & Routes

| Route | Type | Description |
|-------|------|-------------|
| `/` | Server | Redirects to `/runs` |
| `/events` | Client | Browse live Polymarket weather events. Grid/list toggle, category filters, auto-refresh every 60s, click to analyze |
| `/new` | Client | 3-step wizard: (0) Paste URL → auto-extract all sub-markets, (1) Configure weather params, (2) Compute all → redirects to batch page |
| `/runs` | Server | Performance dashboard (Total P&L, Sharpe, Max DD, Avg Edge) + all runs listed, grouped by batch |
| `/runs/[id]` | Server | Single run detail: Trade Decision Card with conviction meter, multi-model ensemble breakdown table, forecast chart, trade plan, backtest section, AI summary |
| `/runs/batch/[batchId]` | Server | Batch comparison: Trader's Verdict, best BUY_NO/YES opportunity cards, full comparison table ranked by edge, refresh prices button |

---

## API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | Fetches Polymarket events (tags: Weather + Daily Temperature), dedupes, sorts by volume. Cached 5min. |
| `/api/market/extract` | POST | Parses a Polymarket URL → calls Gamma API → extracts event + all sub-markets with thresholds and prices |
| `/api/runs/compute` | POST | Computes a single market: fetches weather, calculates probability/edge/Kelly, inserts to DB |
| `/api/runs/compute-batch` | POST | Computes ALL sub-markets: fetches weather once, computes N markets, bulk inserts with shared `batch_id` |
| `/api/runs/backtest` | POST | Fetches actual temperature from Open-Meteo Archive, resolves market, calculates P&L, updates DB |
| `/api/runs/refresh-batch` | POST | Re-fetches latest prices from Polymarket + fresh weather data, recomputes all edges in a batch |
| `/api/ai/summary` | POST | Loads run data, builds prompt, calls OpenAI for trade analysis summary, saves to DB |
| `/api/weather/forecast` | GET | Proxies to Open-Meteo forecast API for client-side chart rendering |

---

## Library Modules

### `src/lib/compute.ts` — Computation Engine

| Function | Description |
|----------|-------------|
| `fetchForecast(lat, lon, targetTime, windowHours)` | Fetches deterministic hourly forecast from Open-Meteo |
| `fetchMultiModelEnsemble(lat, lon, targetDate)` | Fetches ECMWF + GFS ensembles in parallel, pools ~82 members |
| `fetchWeatherData(lat, lon, resolutionTime, windowHours)` | Combines forecast + ensemble fetch into one call |
| `computeStrategyFromData(input, weatherData)` | Pure computation (no API calls): probability, edge, Kelly, trade plan |
| `computeStrategy(input)` | Convenience wrapper: fetches weather then computes |
| `computeBatch(input)` | Batch mode: fetches weather ONCE, computes N sub-markets |

### `src/lib/polymarket.ts` — Market Parsing

| Function | Description |
|----------|-------------|
| `extractSlugFromUrl(url)` | Extracts event slug from Polymarket URL |
| `extractCityFromTitle(title)` | Auto-detects city + lat/lon from a 50-city lookup table |
| `parseTemperatureFromQuestion(question)` | Parses temperature thresholds, rule type, and unit from market question text |
| `fahrenheitToCelsius(f)` | Temperature unit conversion |

### `src/lib/types.ts` — TypeScript Interfaces

Core types: `WeatherStrategyRun`, `ForecastSnapshot`, `EnsembleModelBreakdown`, `TradePlan`, `ComputeInput`, `ComputeResult`, `BacktestResult`, `BatchComputeInput`, `SubMarketInput`, `SubMarketResult`, `PreFetchedWeatherData`, `MultiModelResult`, `SingleModelResult`

### `src/lib/supabase.ts` — Database Clients

- `createBrowserClient()` — Uses anon key for client-side queries
- `createServerClient()` — Uses service role key for server-side operations

### `src/components/charts.tsx` — Visualizations

| Component | Description |
|-----------|-------------|
| `ForecastVsActualChart` | Hourly forecast curve (purple) + actual temps (orange) + threshold reference lines |
| `PnlWaterfallChart` | Per-run P&L bars (green/red) + cumulative P&L line (purple) |
| `EdgeAccuracyChart` | Model prob vs. market prob vs. actual outcome over time |
| `ForecastErrorChart` | Histogram of forecast error buckets (0-1°C, 1-2°C, etc.) |

---

## Database Schema

Single table: **`weather_strategy_runs`**

```sql
weather_strategy_runs
├── id                  uuid (PK, auto-generated)
├── created_at          timestamptz
│
├── market_url          text           -- Polymarket URL
├── market_title        text           -- Event question
├── resolution_time     timestamptz    -- When market resolves
│
├── location_text       text           -- "New York, NY"
├── lat / lon           numeric        -- Coordinates
│
├── rule_type           text           -- "above_below" | "range"
├── threshold_low       numeric        -- Lower bound (°C)
├── threshold_high      numeric        -- Upper bound (°C)
│
├── yes_price / no_price  numeric      -- Current market prices (0-1)
├── fee_bps / slippage_bps  int        -- Fee basis points
│
├── base_size_usd       numeric        -- Position size
├── user_confidence     int            -- 0-100%
├── sigma_temp          numeric        -- Uncertainty (°C)
├── forecast_source     text           -- "open-meteo"
│
├── forecast_snapshot   jsonb          -- Full forecast + ensemble data
├── model_prob          numeric        -- Computed probability
├── market_implied_prob numeric        -- yes_price
├── edge                numeric        -- model_prob - market - fees
├── recommendation      text           -- "BUY_YES" | "BUY_NO" | "NO_TRADE"
├── trade_plan          jsonb          -- Kelly sizing, rationale, assumptions
├── ai_summary          text           -- OpenAI analysis (optional)
│
├── batch_id            uuid           -- Groups sub-markets from same event
├── event_slug          text           -- Polymarket event slug
│
├── actual_temp         numeric        -- Post-resolution actual (backtest)
├── resolved_yes        boolean        -- Did YES win?
├── pnl                 numeric        -- Net P&L after fees
└── backtested_at       timestamptz    -- When backtest was run
```

**Indexes**: `created_at DESC`, `batch_id`

**Migrations**:
- `migration.sql` — Initial schema with core columns
- `migration_002_backtest.sql` — Adds `actual_temp`, `resolved_yes`, `pnl`, `backtested_at`
- `migration_003_batch.sql` — Adds `batch_id`, `event_slug` with index

---

## External APIs

| API | Base URL | Purpose | Auth |
|-----|----------|---------|------|
| **Open-Meteo Forecast** | `api.open-meteo.com/v1/forecast` | Hourly temperature forecast for chart + fallback probability | None (free) |
| **Open-Meteo Ensemble** | `ensemble-api.open-meteo.com/v1/ensemble` | Per-member daily max temps from ECMWF IFS + GFS models | None (free) |
| **Open-Meteo Archive** | `archive-api.open-meteo.com/v1/archive` | Historical actual temperatures for backtest resolution | None (free) |
| **Polymarket Gamma** | `gamma-api.polymarket.com` | Event metadata, sub-market prices, live event browsing | None |
| **OpenAI** | `api.openai.com/v1/chat/completions` | AI-powered trade analysis summaries | `OPENAI_API_KEY` |

---

## Visualizations

- **Temperature Forecast Chart** — Hourly forecast curve with threshold reference lines, shown on individual run detail pages
- **P&L Waterfall** — Per-run P&L bars (green for wins, red for losses) with a cumulative P&L line overlay
- **Model vs. Market vs. Outcome** — Three-line chart showing model probability, market-implied probability, and actual outcome (0/100%) over time
- **Forecast Error Distribution** — Bar chart showing how often the forecast was off by 0-1°C, 1-2°C, 2-3°C, 3-5°C, 5+°C

---

## Setup

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the migrations in order:
   ```
   supabase/migration.sql
   supabase/migration_002_backtest.sql
   supabase/migration_003_batch.sql
   ```
3. Copy your project URL and keys from **Settings > API**

### 2. Environment Variables

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Anon/public key (safe for browser)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-side only, never expose)
- `OPENAI_API_KEY` — *(optional)* For AI summary feature
- `OPENAI_MODEL` — *(optional, default: `gpt-4o-mini`)* OpenAI model to use

### 3. Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Deploy to Vercel

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variables in Vercel project settings
4. Deploy

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | TailwindCSS 4 + shadcn/ui |
| Charts | Recharts 3 |
| Database | Supabase (Postgres) with JSONB columns |
| Weather Data | Open-Meteo (free, no API key required) |
| Market Data | Polymarket Gamma API |
| AI | OpenAI (optional, for summaries) |
| Deployment | Vercel |
