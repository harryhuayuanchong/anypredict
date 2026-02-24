/**
 * Polymarket URL parsing + weather market field extraction
 */

// Well-known city coordinates for auto-resolve
const CITY_COORDS: Record<string, { lat: number; lon: number; full: string }> = {
  nyc: { lat: 40.7128, lon: -73.906, full: "New York" },
  "new york": { lat: 40.7128, lon: -73.906, full: "New York" },
  "new york city": { lat: 40.7128, lon: -73.906, full: "New York" },
  chicago: { lat: 41.8781, lon: -87.6298, full: "Chicago" },
  london: { lat: 51.5074, lon: -0.1278, full: "London" },
  miami: { lat: 25.7617, lon: -80.1918, full: "Miami" },
  seoul: { lat: 37.5665, lon: 126.978, full: "Seoul" },
  wellington: { lat: -41.2924, lon: 174.7787, full: "Wellington" },
  toronto: { lat: 43.6532, lon: -79.3832, full: "Toronto" },
  seattle: { lat: 47.6062, lon: -122.3321, full: "Seattle" },
  dallas: { lat: 32.7767, lon: -96.797, full: "Dallas" },
  atlanta: { lat: 33.749, lon: -84.388, full: "Atlanta" },
  "los angeles": { lat: 34.0522, lon: -118.2437, full: "Los Angeles" },
  la: { lat: 34.0522, lon: -118.2437, full: "Los Angeles" },
  phoenix: { lat: 33.4484, lon: -112.074, full: "Phoenix" },
  denver: { lat: 39.7392, lon: -104.9903, full: "Denver" },
  taipei: { lat: 25.033, lon: 121.5654, full: "Taipei" },
  "hong kong": { lat: 22.3193, lon: 114.1694, full: "Hong Kong" },
  singapore: { lat: 1.3521, lon: 103.8198, full: "Singapore" },
  paris: { lat: 48.8566, lon: 2.3522, full: "Paris" },
  tokyo: { lat: 35.6762, lon: 139.6503, full: "Tokyo" },
  sydney: { lat: -33.8688, lon: 151.2093, full: "Sydney" },
  dubai: { lat: 25.2048, lon: 55.2708, full: "Dubai" },
  boston: { lat: 42.3601, lon: -71.0589, full: "Boston" },
  "san francisco": { lat: 37.7749, lon: -122.4194, full: "San Francisco" },
  sf: { lat: 37.7749, lon: -122.4194, full: "San Francisco" },
  houston: { lat: 29.7604, lon: -95.3698, full: "Houston" },
  "washington dc": { lat: 38.9072, lon: -77.0369, full: "Washington DC" },
  dc: { lat: 38.9072, lon: -77.0369, full: "Washington DC" },
  mumbai: { lat: 19.076, lon: 72.8777, full: "Mumbai" },
  beijing: { lat: 39.9042, lon: 116.4074, full: "Beijing" },
  berlin: { lat: 52.52, lon: 13.405, full: "Berlin" },
  rome: { lat: 41.9028, lon: 12.4964, full: "Rome" },
  madrid: { lat: 40.4168, lon: -3.7038, full: "Madrid" },
  bangkok: { lat: 13.7563, lon: 100.5018, full: "Bangkok" },
  jakarta: { lat: -6.2088, lon: 106.8456, full: "Jakarta" },
  cairo: { lat: 30.0444, lon: 31.2357, full: "Cairo" },
  melbourne: { lat: -37.8136, lon: 144.9631, full: "Melbourne" },
  "mexico city": { lat: 19.4326, lon: -99.1332, full: "Mexico City" },
  "sao paulo": { lat: -23.5505, lon: -46.6333, full: "Sao Paulo" },
  lagos: { lat: 6.5244, lon: 3.3792, full: "Lagos" },
  oslo: { lat: 59.9139, lon: 10.7522, full: "Oslo" },
  stockholm: { lat: 59.3293, lon: 18.0686, full: "Stockholm" },
  amsterdam: { lat: 52.3676, lon: 4.9041, full: "Amsterdam" },
};

/**
 * Extract slug from a Polymarket URL
 * Handles: https://polymarket.com/event/some-slug, https://polymarket.com/event/some-slug?tid=...
 */
export function extractSlugFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    // Match /event/{slug} or /event/{slug}/
    const match = path.match(/\/event\/([^/?]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract city name from event title
 * e.g., "Highest temperature in NYC on February 24?" → "nyc"
 */
export function extractCityFromTitle(title: string): {
  city: string;
  lat: number;
  lon: number;
} | null {
  // Pattern: "... in {City} on ..." or "... in {City}?"
  const match = title.match(/\bin\s+(.+?)\s+(?:on|this|\?)/i);
  if (!match) return null;

  const rawCity = match[1].trim().toLowerCase();
  const coords = CITY_COORDS[rawCity];
  if (coords) {
    return { city: coords.full, lat: coords.lat, lon: coords.lon };
  }

  // Try partial matches
  for (const [key, val] of Object.entries(CITY_COORDS)) {
    if (rawCity.includes(key) || key.includes(rawCity)) {
      return { city: val.full, lat: val.lat, lon: val.lon };
    }
  }

  return null;
}

/** F to C conversion */
export function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

/**
 * Parse temperature thresholds from a sub-market question
 * Examples:
 *   "25 F or below" → { rule_type: "above_below", low: null, high: 25, unit: "F", direction: "below" }
 *   "40 F or higher" → { rule_type: "above_below", low: 40, high: null, unit: "F", direction: "above" }
 *   "26-27 F" → { rule_type: "range", low: 26, high: 27, unit: "F" }
 *   "32-33 F" → { rule_type: "range", low: 32, high: 33, unit: "F" }
 */
export function parseTemperatureFromQuestion(question: string): {
  rule_type: "above_below" | "range";
  threshold_low_f: number | null;
  threshold_high_f: number | null;
  threshold_low_c: number | null;
  threshold_high_c: number | null;
  unit: string;
  label: string;
} | null {
  // Pattern: "X F or below" / "X F or lower"
  let match = question.match(/(\d+(?:\.\d+)?)\s*°?\s*([FCfc])\s+or\s+(?:below|lower)/i);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const valC = unit === "F" ? fahrenheitToCelsius(val) : val;
    return {
      rule_type: "above_below",
      threshold_low_f: null,
      threshold_high_f: val,
      threshold_low_c: null,
      threshold_high_c: valC,
      unit,
      label: `≤ ${val}°${unit} (≤ ${valC}°C)`,
    };
  }

  // Pattern: "X F or above" / "X F or higher"
  match = question.match(/(\d+(?:\.\d+)?)\s*°?\s*([FCfc])\s+or\s+(?:above|higher)/i);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const valC = unit === "F" ? fahrenheitToCelsius(val) : val;
    return {
      rule_type: "above_below",
      threshold_low_f: val,
      threshold_high_f: null,
      threshold_low_c: valC,
      threshold_high_c: null,
      unit,
      label: `≥ ${val}°${unit} (≥ ${valC}°C)`,
    };
  }

  // Pattern: "X-Y F" (range)
  match = question.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*°?\s*([FCfc])/i);
  if (match) {
    const low = parseFloat(match[1]);
    const high = parseFloat(match[2]);
    const unit = match[3].toUpperCase();
    const lowC = unit === "F" ? fahrenheitToCelsius(low) : low;
    const highC = unit === "F" ? fahrenheitToCelsius(high) : high;
    return {
      rule_type: "range",
      threshold_low_f: low,
      threshold_high_f: high,
      threshold_low_c: lowC,
      threshold_high_c: highC,
      unit,
      label: `${low}–${high}°${unit} (${lowC}–${highC}°C)`,
    };
  }

  return null;
}

/** Sub-market info parsed for the UI */
export interface ParsedSubMarket {
  id: string;
  question: string;
  yes_price: number;
  no_price: number;
  rule_type: "above_below" | "range";
  threshold_low_c: number | null;
  threshold_high_c: number | null;
  threshold_low_f: number | null;
  threshold_high_f: number | null;
  unit: string;
  label: string;
  liquidity: number;
  volume: number;
}

/** Full extracted event info */
export interface ExtractedEvent {
  event_title: string;
  event_slug: string;
  event_url: string;
  description: string;
  end_date: string | null;
  resolution_source: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  sub_markets: ParsedSubMarket[];
  raw_event: Record<string, unknown>;
}
