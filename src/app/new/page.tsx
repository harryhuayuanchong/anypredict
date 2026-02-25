"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { ExtractedEvent } from "@/lib/polymarket";

// Well-known cities for manual fallback (weather events)
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  "New York": { lat: 40.7128, lon: -73.906 },
  "Los Angeles": { lat: 34.0522, lon: -118.2437 },
  Chicago: { lat: 41.8781, lon: -87.6298 },
  London: { lat: 51.5074, lon: -0.1278 },
  Tokyo: { lat: 35.6762, lon: 139.6503 },
  Paris: { lat: 48.8566, lon: 2.3522 },
  Sydney: { lat: -33.8688, lon: 151.2093 },
  Dubai: { lat: 25.2048, lon: 55.2708 },
  Singapore: { lat: 1.3521, lon: 103.8198 },
  Miami: { lat: 25.7617, lon: -80.1918 },
  Phoenix: { lat: 33.4484, lon: -112.074 },
  Denver: { lat: 39.7392, lon: -104.9903 },
  Taipei: { lat: 25.033, lon: 121.5654 },
  "Hong Kong": { lat: 22.3193, lon: 114.1694 },
  Seoul: { lat: 37.5665, lon: 126.978 },
};

// Seismic regions for earthquake events
const SEISMIC_REGIONS: Record<string, { lat: number; lon: number; radius_km: number }> = {
  "California": { lat: 36.7783, lon: -119.4179, radius_km: 400 },
  "Japan": { lat: 36.2048, lon: 138.2529, radius_km: 500 },
  "Turkey": { lat: 39.9334, lon: 32.8597, radius_km: 500 },
  "Indonesia": { lat: -0.7893, lon: 113.9213, radius_km: 800 },
  "Chile": { lat: -35.6751, lon: -71.543, radius_km: 500 },
  "Mexico": { lat: 23.6345, lon: -102.5528, radius_km: 500 },
  "Alaska": { lat: 64.2008, lon: -152.4937, radius_km: 500 },
  "Taiwan": { lat: 23.6978, lon: 120.9605, radius_km: 250 },
  "Philippines": { lat: 12.8797, lon: 121.774, radius_km: 500 },
  "New Zealand": { lat: -40.9006, lon: 174.886, radius_km: 400 },
  "Italy": { lat: 41.8719, lon: 12.5674, radius_km: 400 },
  "Greece": { lat: 39.0742, lon: 21.8243, radius_km: 300 },
  "Nepal": { lat: 28.3949, lon: 84.124, radius_km: 300 },
  "Hawaii": { lat: 19.8968, lon: -155.5828, radius_km: 300 },
  "Iceland": { lat: 64.9631, lon: -19.0208, radius_km: 250 },
};

/** Category-specific display config */
const CATEGORY_DISPLAY: Record<string, {
  icon: string;
  color: string;
  locationLabel: string;
  locationPlaceholder: string;
  dataSource: string;
}> = {
  Temperature: { icon: "🌡️", color: "text-red-500", locationLabel: "City", locationPlaceholder: "New York", dataSource: "Open-Meteo" },
  Snow: { icon: "❄️", color: "text-blue-400", locationLabel: "City", locationPlaceholder: "Denver", dataSource: "Open-Meteo" },
  Rain: { icon: "🌧️", color: "text-blue-600", locationLabel: "City", locationPlaceholder: "Seattle", dataSource: "Open-Meteo" },
  Storm: { icon: "🌪️", color: "text-purple-500", locationLabel: "City", locationPlaceholder: "Miami", dataSource: "Open-Meteo" },
  Earthquake: { icon: "🌍", color: "text-amber-600", locationLabel: "Region / Epicenter", locationPlaceholder: "California", dataSource: "USGS Historical" },
  ClimateAnomaly: { icon: "📊", color: "text-emerald-600", locationLabel: "Global Index", locationPlaceholder: "Global", dataSource: "NASA GISS GISTEMP" },
  Climate: { icon: "🌡️", color: "text-orange-500", locationLabel: "City", locationPlaceholder: "New York", dataSource: "Open-Meteo" },
  Weather: { icon: "⛅", color: "text-sky-500", locationLabel: "City", locationPlaceholder: "New York", dataSource: "Open-Meteo" },
};

interface FormData {
  market_url: string;
  resolution_time: string;
  location_text: string;
  lat: string;
  lon: string;
  fee_bps: string;
  slippage_bps: string;
  forecast_source: string;
  time_window_hours: string;
  sigma_temp: string;
  confidence_notes: string;
  base_size_usd: string;
  user_confidence: string;
  min_edge: string;
}

/** Sigma defaults per weather metric */
const SIGMA_DEFAULTS: Record<string, { sigma: string; label: string; unit: string }> = {
  temperature: { sigma: "1.5", label: "σ Temperature (°C)", unit: "°C" },
  snowfall: { sigma: "2.0", label: "σ Snowfall (cm)", unit: "cm" },
  rainfall: { sigma: "5.0", label: "σ Rainfall (mm)", unit: "mm" },
  wind_speed: { sigma: "10.0", label: "σ Wind Gusts (km/h)", unit: "km/h" },
  earthquake_magnitude: { sigma: "0.5", label: "σ Magnitude (Richter)", unit: "M" },
  climate_anomaly: { sigma: "0.15", label: "σ Anomaly (°C)", unit: "°C" },
};

const DEFAULT_FORM: FormData = {
  market_url: "",
  resolution_time: "",
  location_text: "",
  lat: "",
  lon: "",
  fee_bps: "200",
  slippage_bps: "50",
  forecast_source: "open-meteo",
  time_window_hours: "3",
  sigma_temp: "1.5",
  confidence_notes: "",
  base_size_usd: "100",
  user_confidence: "50",
  min_edge: "0.05",
};

export default function NewRunPage() {
  return (
    <Suspense fallback={<div className="py-8 text-center text-muted-foreground">Loading...</div>}>
      <NewRunPageInner />
    </Suspense>
  );
}

function NewRunPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-extract state
  const [extracting, setExtracting] = useState(false);
  const [extractedEvent, setExtractedEvent] = useState<ExtractedEvent | null>(
    null
  );
  const [weatherMetric, setWeatherMetric] = useState<string>("temperature");
  const [weatherCategory, setWeatherCategory] = useState<string>("Temperature");
  const [weatherUnit, setWeatherUnit] = useState<string>("°C");
  const [locationType, setLocationType] = useState<"city" | "region" | "global" | "unknown">("unknown");
  const [searchRadiusKm, setSearchRadiusKm] = useState<string>("250");

  const set = (key: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ─── Auto-extract from Polymarket URL ───
  const handleExtract = useCallback(async (url: string) => {
    if (!url) return;
    setExtracting(true);
    setError(null);
    setExtractedEvent(null);

    try {
      const res = await fetch("/api/market/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extract failed");

      const event = data as ExtractedEvent;
      setExtractedEvent(event);

      // Extract weather metric info from response
      const metric = data.weather_metric ?? "temperature";
      const category = data.weather_category ?? "Temperature";
      const unit = data.weather_unit ?? "°C";
      const locType = data.location_type ?? "unknown";
      const radius = data.search_radius_km ?? 250;
      setWeatherMetric(metric);
      setWeatherCategory(category);
      setWeatherUnit(unit);
      setLocationType(locType as "city" | "region" | "global" | "unknown");
      setSearchRadiusKm(radius.toString());

      // Get appropriate sigma default for this metric
      const sigmaDefault = SIGMA_DEFAULTS[metric]?.sigma ?? "1.5";

      // Auto-fill event-level fields
      setForm((prev) => ({
        ...prev,
        market_url: url,
        resolution_time: event.end_date
          ? new Date(event.end_date).toISOString().slice(0, 16)
          : prev.resolution_time,
        location_text: event.city || prev.location_text,
        lat: event.lat?.toString() || prev.lat,
        lon: event.lon?.toString() || prev.lon,
        sigma_temp: sigmaDefault,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setExtracting(false);
    }
  }, []);

  // Auto-extract if URL is provided via query params (from Events page)
  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam) {
      setForm((prev) => ({ ...prev, market_url: urlParam }));
      handleExtract(urlParam);
    }
  }, [searchParams, handleExtract]);

  // ─── Manual city select ───
  const handleCitySelect = (city: string) => {
    const coords = CITY_COORDS[city];
    if (coords) {
      setForm((prev) => ({
        ...prev,
        location_text: city,
        lat: coords.lat.toString(),
        lon: coords.lon.toString(),
      }));
    }
  };

  // ─── Region select for earthquake events ───
  const handleRegionSelect = (region: string) => {
    const data = SEISMIC_REGIONS[region];
    if (data) {
      setForm((prev) => ({
        ...prev,
        location_text: region,
        lat: data.lat.toString(),
        lon: data.lon.toString(),
      }));
      setSearchRadiusKm(data.radius_km.toString());
    }
  };

  const isEarthquake = weatherCategory === "Earthquake";
  const isGlobalIndex = locationType === "global" || weatherCategory === "ClimateAnomaly";
  const categoryDisplay = CATEGORY_DISPLAY[weatherCategory] ?? CATEGORY_DISPLAY.Weather;

  // Can proceed: need URL, extracted event with sub-markets, resolution time, and location (unless global)
  const canProceedA =
    form.market_url &&
    extractedEvent &&
    extractedEvent.sub_markets.length > 0 &&
    form.resolution_time &&
    (isGlobalIndex || (form.lat && form.lon));

  // ─── Batch compute all markets ───
  const handleBatchCompute = async () => {
    if (!extractedEvent) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/runs/compute-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_url: form.market_url,
          event_title: extractedEvent.event_title,
          event_slug: extractedEvent.event_slug,
          resolution_time: new Date(form.resolution_time).toISOString(),
          location_text:
            form.location_text || `${form.lat}, ${form.lon}`,
          lat: parseFloat(form.lat),
          lon: parseFloat(form.lon),
          fee_bps: parseInt(form.fee_bps) || 0,
          slippage_bps: parseInt(form.slippage_bps) || 0,
          base_size_usd: parseFloat(form.base_size_usd) || 0,
          user_confidence: parseInt(form.user_confidence) || 50,
          sigma_temp: parseFloat(form.sigma_temp) || 1.5,
          forecast_source: form.forecast_source,
          time_window_hours: parseInt(form.time_window_hours) || 3,
          min_edge: parseFloat(form.min_edge) || 0.05,
          neg_risk: extractedEvent.neg_risk,
          weather_metric: weatherMetric,
          sub_markets: extractedEvent.sub_markets.map((sm) => ({
            id: sm.id,
            question: sm.question,
            rule_type: sm.rule_type,
            threshold_low: sm.threshold_low_c,
            threshold_high: sm.threshold_high_c,
            yes_price: sm.yes_price,
            no_price: sm.no_price,
            label: sm.label,
            clob_token_id_yes: sm.clob_token_id_yes,
            clob_token_id_no: sm.clob_token_id_no,
            condition_id: sm.condition_id,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch compute failed");

      router.push(`/runs/batch/${data.batch_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    "Event & Markets",
    isGlobalIndex ? "Climate Config" : isEarthquake ? "Seismic Config" : "Weather Config",
    "Compute All",
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New Event Analysis</h1>

      {/* Step indicator */}
      <div className="flex gap-2">
        {steps.map((s, i) => (
          <button
            key={s}
            onClick={() => (i <= step ? setStep(i as 0 | 1 | 2) : undefined)}
            className={`flex-1 py-2 px-3 text-sm rounded-md transition-colors ${
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                ? "bg-muted text-foreground cursor-pointer"
                : "bg-muted/50 text-muted-foreground cursor-not-allowed"
            }`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Step 0: Event & Markets                                */}
      {/* ═══════════════════════════════════════════════════════ */}
      {step === 0 && (
        <div className="space-y-4">
          {/* URL Extract Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Paste Event URL
                <Badge variant="secondary" className="text-xs font-normal">
                  auto-fill
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="https://polymarket.com/event/highest-temperature-in-nyc-on-..."
                  value={form.market_url}
                  onChange={(e) => set("market_url", e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleExtract(form.market_url);
                  }}
                />
                <Button
                  onClick={() => handleExtract(form.market_url)}
                  disabled={extracting || !form.market_url}
                  variant="secondary"
                >
                  {extracting ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                      Fetching...
                    </span>
                  ) : (
                    "Extract"
                  )}
                </Button>
              </div>

              {error && !extractedEvent && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              {/* Extracted event info with ALL sub-markets */}
              {extractedEvent && (
                <div className="rounded-md bg-muted p-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">
                        {extractedEvent.event_title}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          <span className="mr-1">{categoryDisplay.icon}</span>
                          {weatherCategory}
                        </Badge>
                        {extractedEvent.city && (
                          <span className="text-xs text-muted-foreground">
                            {isEarthquake ? "Region" : "Location"}: {extractedEvent.city}
                            {extractedEvent.lat && ` (${extractedEvent.lat}, ${extractedEvent.lon})`}
                          </span>
                        )}
                        {!extractedEvent.city && (
                          <span className="text-xs text-amber-600">
                            ⚠ No location detected — set manually below
                          </span>
                        )}
                      </div>
                      {extractedEvent.end_date && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Ends:{" "}
                          {new Date(extractedEvent.end_date).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {extractedEvent.sub_markets.length} markets
                    </Badge>
                  </div>

                  {/* All sub-markets preview */}
                  {extractedEvent.sub_markets.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        All {weatherCategory.toLowerCase()} buckets (will be analyzed together):
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {extractedEvent.sub_markets.map((sm) => (
                          <div
                            key={sm.id}
                            className="rounded-md border border-border bg-background p-2 text-xs"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-medium">{sm.label}</span>
                              <span className="font-mono text-muted-foreground">
                                {(sm.yes_price * 100).toFixed(0)}¢ /{" "}
                                {(sm.no_price * 100).toFixed(0)}¢
                              </span>
                            </div>
                            <div className="text-muted-foreground mt-0.5 truncate">
                              {sm.question}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {extractedEvent.resolution_source && (
                    <p className="text-xs text-muted-foreground">
                      Resolution source: {extractedEvent.resolution_source}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shared Event Config */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Event Details
                {extractedEvent && (
                  <span className="text-xs font-normal text-muted-foreground">
                    (auto-filled — edit as needed)
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="resolution_time">Resolution Time</Label>
                  <Input
                    id="resolution_time"
                    type="datetime-local"
                    value={form.resolution_time}
                    onChange={(e) => set("resolution_time", e.target.value)}
                  />
                </div>
                {extractedEvent && (
                  <div className="space-y-2">
                    <Label>Data Source</Label>
                    <div className="flex items-center h-9 px-3 rounded-md border bg-muted/50 text-sm">
                      <span className="mr-2">{categoryDisplay.icon}</span>
                      {categoryDisplay.dataSource}
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* Location — hidden for global index events, adapts for others */}
              {isGlobalIndex ? (
                <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 text-sm">
                  <p className="font-medium text-emerald-800 dark:text-emerald-300">
                    Global Index — No Location Required
                  </p>
                  <p className="text-emerald-700 dark:text-emerald-400 text-xs mt-1">
                    This event resolves from NASA&apos;s Global Land-Ocean Temperature Index (GISTEMP),
                    a worldwide average — no specific coordinates needed.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>
                      {categoryDisplay.locationLabel}
                      {extractedEvent?.city && locationType !== "unknown" && (
                        <span className="text-xs text-green-600 ml-1">
                          (auto-detected: {extractedEvent.city})
                        </span>
                      )}
                    </Label>

                    {/* Show presets only when no location auto-detected */}
                    {(!extractedEvent?.city || locationType === "unknown") && (
                      <div className="flex flex-wrap gap-1">
                        {isEarthquake
                          ? Object.keys(SEISMIC_REGIONS).map((region) => (
                              <button
                                key={region}
                                type="button"
                                onClick={() => handleRegionSelect(region)}
                                className={`text-xs px-2 py-1 rounded border transition-colors ${
                                  form.location_text === region
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted hover:bg-muted/80 border-transparent"
                                }`}
                              >
                                {region}
                              </button>
                            ))
                          : Object.keys(CITY_COORDS).map((city) => (
                              <button
                                key={city}
                                type="button"
                                onClick={() => handleCitySelect(city)}
                                className={`text-xs px-2 py-1 rounded border transition-colors ${
                                  form.location_text === city
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted hover:bg-muted/80 border-transparent"
                                }`}
                              >
                                {city}
                              </button>
                            ))}
                      </div>
                    )}
                  </div>

                  <div className={`grid gap-4 ${isEarthquake ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
                    <div className="space-y-2">
                      <Label htmlFor="location_text">
                        {isEarthquake ? "Region Name" : "Location Name"}
                      </Label>
                      <Input
                        id="location_text"
                        placeholder={categoryDisplay.locationPlaceholder}
                        value={form.location_text}
                        onChange={(e) => set("location_text", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lat">
                        {isEarthquake ? "Center Lat" : "Latitude"}
                      </Label>
                      <Input
                        id="lat"
                        type="number"
                        step="0.0001"
                        placeholder={isEarthquake ? "36.7783" : "40.7128"}
                        value={form.lat}
                        onChange={(e) => set("lat", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lon">
                        {isEarthquake ? "Center Lon" : "Longitude"}
                      </Label>
                      <Input
                        id="lon"
                        type="number"
                        step="0.0001"
                        placeholder={isEarthquake ? "-119.4179" : "-73.9060"}
                        value={form.lon}
                        onChange={(e) => set("lon", e.target.value)}
                      />
                    </div>
                    {isEarthquake && (
                      <div className="space-y-2">
                        <Label htmlFor="search_radius">Search Radius (km)</Label>
                        <Input
                          id="search_radius"
                          type="number"
                          min="50"
                          max="2000"
                          step="50"
                          value={searchRadiusKm}
                          onChange={(e) => setSearchRadiusKm(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          USGS search radius around the center point
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              <Separator />

              {/* Fees */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fee_bps">Fee (bps)</Label>
                  <Input
                    id="fee_bps"
                    type="number"
                    value={form.fee_bps}
                    onChange={(e) => set("fee_bps", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slippage_bps">Slippage (bps)</Label>
                  <Input
                    id="slippage_bps"
                    type="number"
                    value={form.slippage_bps}
                    onChange={(e) => set("slippage_bps", e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setStep(1)} disabled={!canProceedA}>
                  Next: {isGlobalIndex ? "Climate Config" : isEarthquake ? "Seismic Config" : "Weather Config"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Step 1: Weather Config                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isGlobalIndex ? "Climate Index Configuration" : isEarthquake ? "Seismic Configuration" : "Weather Configuration"}
              <Badge variant="secondary" className="text-xs font-normal">
                <span className="mr-1">{categoryDisplay.icon}</span>
                {weatherCategory}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="forecast_source">
                  {isGlobalIndex || isEarthquake ? "Data Source" : "Forecast Source"}
                </Label>
                {isGlobalIndex ? (
                  <div className="flex items-center h-9 px-3 rounded-md border bg-muted/50 text-sm">
                    📊 NASA GISS GISTEMP (1880–present)
                  </div>
                ) : isEarthquake ? (
                  <div className="flex items-center h-9 px-3 rounded-md border bg-muted/50 text-sm">
                    🌍 USGS Historical Frequency (20yr lookback)
                  </div>
                ) : (
                  <Select
                    value={form.forecast_source}
                    onValueChange={(v) => set("forecast_source", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open-meteo">
                        Open-Meteo (free)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {!isEarthquake && !isGlobalIndex && (
                <div className="space-y-2">
                  <Label htmlFor="time_window_hours">
                    Time Window (± hours)
                  </Label>
                  <Input
                    id="time_window_hours"
                    type="number"
                    min="0"
                    max="24"
                    value={form.time_window_hours}
                    onChange={(e) => set("time_window_hours", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Hours before/after target time to fetch forecast data
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="sigma_temp">
                  {SIGMA_DEFAULTS[weatherMetric]?.label ?? "σ (uncertainty)"}
                </Label>
                <Input
                  id="sigma_temp"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="50"
                  value={form.sigma_temp}
                  onChange={(e) => set("sigma_temp", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {isGlobalIndex
                    ? `Uncertainty in the climate trend extrapolation. Default ${SIGMA_DEFAULTS[weatherMetric]?.sigma ?? "0.15"}${weatherUnit}.`
                    : isEarthquake
                    ? `Uncertainty in magnitude estimation. Default ${SIGMA_DEFAULTS[weatherMetric]?.sigma ?? "0.5"}${weatherUnit}.`
                    : `Standard deviation for normal distribution model. Higher = more uncertain. Default ${SIGMA_DEFAULTS[weatherMetric]?.sigma ?? "1.5"}${weatherUnit}.`
                  }
                </p>
              </div>
            </div>

            {isGlobalIndex && (
              <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 text-sm">
                <p className="font-medium text-emerald-800 dark:text-emerald-300 mb-1">
                  Climate Anomaly Analysis Method
                </p>
                <p className="text-emerald-700 dark:text-emerald-400 text-xs">
                  Uses NASA GISS GISTEMP historical monthly anomaly data (1880–present).
                  A linear trend is fitted to recent decades, and a synthetic ensemble of 1,000 scenarios
                  is generated from the trend-adjusted residual distribution to estimate bracket probabilities.
                </p>
              </div>
            )}

            {isEarthquake && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-300 mb-1">
                  Earthquake Analysis Method
                </p>
                <p className="text-amber-700 dark:text-amber-400 text-xs">
                  Uses USGS historical earthquake data within {searchRadiusKm}km of the center point.
                  A synthetic ensemble of 1,000 scenarios is generated using Poisson frequency modeling
                  and the Gutenberg-Richter magnitude distribution to estimate probabilities.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="confidence_notes">
                Confidence Notes (optional)
              </Label>
              <Textarea
                id="confidence_notes"
                placeholder={isEarthquake
                  ? "Any knowledge about recent seismic activity in this region?"
                  : "Why do you trust this forecast? Any local knowledge?"
                }
                value={form.confidence_notes}
                onChange={(e) => set("confidence_notes", e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button onClick={() => setStep(2)}>Next: Compute</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* Step 2: Compute All                                     */}
      {/* ═══════════════════════════════════════════════════════ */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Analyze All Markets
              {extractedEvent && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {extractedEvent.sub_markets.length} markets
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="base_size_usd">Base Size ($)</Label>
                <Input
                  id="base_size_usd"
                  type="number"
                  min="0"
                  value={form.base_size_usd}
                  onChange={(e) => set("base_size_usd", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="user_confidence">Confidence (0–100)</Label>
                <Input
                  id="user_confidence"
                  type="number"
                  min="0"
                  max="100"
                  value={form.user_confidence}
                  onChange={(e) => set("user_confidence", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Scales position: size = base × confidence/100
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="min_edge">Min Edge (0–1)</Label>
                <Input
                  id="min_edge"
                  type="number"
                  step="0.01"
                  min="0"
                  max="0.5"
                  value={form.min_edge}
                  onChange={(e) => set("min_edge", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum edge to trigger trade signal (default 5%)
                </p>
              </div>
            </div>

            <Separator />

            {/* Summary before compute */}
            <div className="rounded-md bg-muted p-4 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {extractedEvent?.event_title || "—"}
                </p>
                <Badge variant="secondary" className="text-xs shrink-0">
                  <span className="mr-1">{categoryDisplay.icon}</span>
                  {weatherCategory}
                </Badge>
              </div>
              <div className="grid gap-1 text-muted-foreground">
                {!isGlobalIndex && (
                  <p>
                    <span className="text-foreground font-medium">
                      {isEarthquake ? "Region:" : "Location:"}
                    </span>{" "}
                    {form.location_text || `${form.lat}, ${form.lon}`}
                    {isEarthquake && ` (${searchRadiusKm}km radius)`}
                  </p>
                )}
                {isGlobalIndex && (
                  <p>
                    <span className="text-foreground font-medium">Scope:</span>{" "}
                    Global Land-Ocean Temperature Index
                  </p>
                )}
                <p>
                  <span className="text-foreground font-medium">Resolution:</span>{" "}
                  {form.resolution_time || "—"}
                </p>
                <p>
                  <span className="text-foreground font-medium">Markets:</span>{" "}
                  {extractedEvent?.sub_markets.length || 0} {weatherCategory.toLowerCase()} buckets
                </p>
                <p>
                  <span className="text-foreground font-medium">
                    {isEarthquake ? "Source:" : "Forecast:"}
                  </span>{" "}
                  {categoryDisplay.dataSource}
                </p>
                <p>
                  <span className="text-foreground font-medium">Sigma:</span>{" "}
                  {form.sigma_temp}{weatherUnit}
                </p>
                <p>
                  <span className="text-foreground font-medium">Size:</span> $
                  {form.base_size_usd} × {form.user_confidence}% = $
                  {(
                    (parseFloat(form.base_size_usd) || 0) *
                    ((parseInt(form.user_confidence) || 0) / 100)
                  ).toFixed(2)}
                </p>
              </div>

              {/* Quick market preview */}
              {extractedEvent && extractedEvent.sub_markets.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Markets to analyze:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {extractedEvent.sub_markets.map((sm) => (
                      <span
                        key={sm.id}
                        className="inline-flex items-center gap-1 text-xs bg-background border rounded px-1.5 py-0.5"
                      >
                        {sm.label}
                        <span className="text-muted-foreground font-mono">
                          {(sm.yes_price * 100).toFixed(0)}¢
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={handleBatchCompute} disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    Analyzing {extractedEvent?.sub_markets.length || 0}{" "}
                    markets...
                  </span>
                ) : (
                  `Compute All ${extractedEvent?.sub_markets.length || 0} Markets`
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
