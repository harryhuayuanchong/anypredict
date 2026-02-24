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

// Well-known cities for manual fallback
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

  // Can proceed: need URL, extracted event with sub-markets, location, and resolution time
  const canProceedA =
    form.market_url &&
    extractedEvent &&
    extractedEvent.sub_markets.length > 0 &&
    form.resolution_time &&
    form.lat &&
    form.lon;

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
          sub_markets: extractedEvent.sub_markets.map((sm) => ({
            id: sm.id,
            question: sm.question,
            rule_type: sm.rule_type,
            threshold_low: sm.threshold_low_c,
            threshold_high: sm.threshold_high_c,
            yes_price: sm.yes_price,
            no_price: sm.no_price,
            label: sm.label,
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

  const steps = ["Event & Markets", "Weather Config", "Compute All"];

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
                      {extractedEvent.city && (
                        <p className="text-xs text-muted-foreground">
                          Location: {extractedEvent.city} (
                          {extractedEvent.lat}, {extractedEvent.lon})
                        </p>
                      )}
                      {extractedEvent.end_date && (
                        <p className="text-xs text-muted-foreground">
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
                        All temperature buckets (will be analyzed together):
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
              <CardTitle className="text-base">
                Event Details
                {extractedEvent && (
                  <span className="text-xs font-normal text-muted-foreground ml-2">
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
              </div>

              <Separator />

              {/* Location */}
              <div className="space-y-2">
                <Label>
                  Location
                  {extractedEvent?.city && (
                    <span className="text-xs text-green-600 ml-1">
                      (auto-detected: {extractedEvent.city})
                    </span>
                  )}
                </Label>
                {!extractedEvent?.city && (
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(CITY_COORDS).map((city) => (
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

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="location_text">Location Name</Label>
                  <Input
                    id="location_text"
                    placeholder="New York"
                    value={form.location_text}
                    onChange={(e) => set("location_text", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lat">Latitude</Label>
                  <Input
                    id="lat"
                    type="number"
                    step="0.0001"
                    placeholder="40.7128"
                    value={form.lat}
                    onChange={(e) => set("lat", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lon">Longitude</Label>
                  <Input
                    id="lon"
                    type="number"
                    step="0.0001"
                    placeholder="-73.9060"
                    value={form.lon}
                    onChange={(e) => set("lon", e.target.value)}
                  />
                </div>
              </div>

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
                  Next: Weather Config
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
            <CardTitle>Weather Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="forecast_source">Forecast Source</Label>
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
              </div>

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

              <div className="space-y-2">
                <Label htmlFor="sigma_temp">Sigma σ (°C uncertainty)</Label>
                <Input
                  id="sigma_temp"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  value={form.sigma_temp}
                  onChange={(e) => set("sigma_temp", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Standard deviation for normal distribution model. Higher =
                  more uncertain. Default 1.5°C.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confidence_notes">
                Confidence Notes (optional)
              </Label>
              <Textarea
                id="confidence_notes"
                placeholder="Why do you trust this forecast? Any local knowledge?"
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
              <p className="font-medium">
                {extractedEvent?.event_title || "—"}
              </p>
              <div className="grid gap-1 text-muted-foreground">
                <p>
                  <span className="text-foreground font-medium">Location:</span>{" "}
                  {form.location_text || `${form.lat}, ${form.lon}`}
                </p>
                <p>
                  <span className="text-foreground font-medium">Resolution:</span>{" "}
                  {form.resolution_time || "—"}
                </p>
                <p>
                  <span className="text-foreground font-medium">Markets:</span>{" "}
                  {extractedEvent?.sub_markets.length || 0} temperature buckets
                </p>
                <p>
                  <span className="text-foreground font-medium">Sigma:</span>{" "}
                  {form.sigma_temp}°C
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
