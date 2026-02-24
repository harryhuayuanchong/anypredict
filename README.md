# AnyPredict

Prediction market analysis platform. Evaluate markets on Polymarket using forecast data, compute edges, and backtest against actual outcomes. Currently supports weather markets, with geopolitics, sports, and politics coming soon.

## Setup

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run `supabase/migration.sql`
3. If upgrading from a previous version, also run `supabase/migration_002_backtest.sql`
4. Copy your project URL and keys from Settings > API

### 2. Environment Variables

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-side only)
- `OPENAI_API_KEY` — (optional) for AI summary feature
- `OPENAI_MODEL` — (optional, default: `gpt-4o-mini`)

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

## Pages

- `/runs` — List of all strategy runs with aggregate stats and charts
- `/new` — Create a new strategy run (paste Polymarket URL to auto-fill)
- `/runs/[id]` — Detailed view of a run with trade plan, forecast chart, and backtest results

## How It Works

1. **Market Input** — Paste Polymarket URL to auto-extract event + sub-markets, or manually fill market details
2. **Weather Config** — Configure forecast source (Open-Meteo), time window, and uncertainty (sigma)
3. **Compute** — Fetches weather forecast, computes probability using normal distribution, calculates edge vs market odds, generates trade plan
4. **Save** — Results saved to Supabase for comparison across runs
5. **Backtest** — After resolution, fetch actual temperature and calculate P&L

## Visualizations

- **Temperature forecast chart** — Hourly forecast curve with threshold lines (per run)
- **P&L waterfall** — Per-run P&L bars + cumulative P&L line (runs dashboard)
- **Model vs Market vs Outcome** — Probability accuracy over time (runs dashboard)
- **Forecast error distribution** — How often the forecast was off by 0-1°C, 1-2°C, etc.

## Tech Stack

- Next.js 14+ (App Router, TypeScript)
- TailwindCSS + shadcn/ui
- Recharts (visualization)
- Supabase (Postgres)
- Open-Meteo (free weather forecast + historical archive API, no key required)
- OpenAI (optional, for AI summaries)
