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

// Well-known seismic regions / countries for earthquake events
const REGION_COORDS: Record<string, { lat: number; lon: number; full: string; radius_km: number }> = {
  california: { lat: 36.7783, lon: -119.4179, full: "California", radius_km: 400 },
  "southern california": { lat: 34.0, lon: -117.5, full: "Southern California", radius_km: 250 },
  "northern california": { lat: 38.5, lon: -121.5, full: "Northern California", radius_km: 250 },
  "san andreas": { lat: 35.8, lon: -120.4, full: "San Andreas Fault", radius_km: 200 },
  japan: { lat: 36.2048, lon: 138.2529, full: "Japan", radius_km: 500 },
  tokyo: { lat: 35.6762, lon: 139.6503, full: "Tokyo Region", radius_km: 200 },
  turkey: { lat: 39.9334, lon: 32.8597, full: "Turkey", radius_km: 500 },
  türkiye: { lat: 39.9334, lon: 32.8597, full: "Turkey", radius_km: 500 },
  indonesia: { lat: -0.7893, lon: 113.9213, full: "Indonesia", radius_km: 800 },
  chile: { lat: -35.6751, lon: -71.543, full: "Chile", radius_km: 500 },
  mexico: { lat: 23.6345, lon: -102.5528, full: "Mexico", radius_km: 500 },
  nepal: { lat: 28.3949, lon: 84.124, full: "Nepal", radius_km: 300 },
  iran: { lat: 32.4279, lon: 53.688, full: "Iran", radius_km: 500 },
  italy: { lat: 41.8719, lon: 12.5674, full: "Italy", radius_km: 400 },
  greece: { lat: 39.0742, lon: 21.8243, full: "Greece", radius_km: 300 },
  "new zealand": { lat: -40.9006, lon: 174.886, full: "New Zealand", radius_km: 400 },
  philippines: { lat: 12.8797, lon: 121.774, full: "Philippines", radius_km: 500 },
  taiwan: { lat: 23.6978, lon: 120.9605, full: "Taiwan", radius_km: 250 },
  alaska: { lat: 64.2008, lon: -152.4937, full: "Alaska", radius_km: 500 },
  hawaii: { lat: 19.8968, lon: -155.5828, full: "Hawaii", radius_km: 300 },
  iceland: { lat: 64.9631, lon: -19.0208, full: "Iceland", radius_km: 250 },
  china: { lat: 35.8617, lon: 104.1954, full: "China", radius_km: 800 },
  india: { lat: 20.5937, lon: 78.9629, full: "India", radius_km: 600 },
  pacific: { lat: 0.0, lon: -160.0, full: "Pacific Ocean", radius_km: 1000 },
  "ring of fire": { lat: 0.0, lon: 160.0, full: "Ring of Fire", radius_km: 2000 },
  "pacific ring of fire": { lat: 0.0, lon: 160.0, full: "Ring of Fire", radius_km: 2000 },
  peru: { lat: -9.19, lon: -75.0152, full: "Peru", radius_km: 400 },
  colombia: { lat: 4.5709, lon: -74.2973, full: "Colombia", radius_km: 400 },
  "el salvador": { lat: 13.7942, lon: -88.8965, full: "El Salvador", radius_km: 200 },
  "costa rica": { lat: 9.7489, lon: -83.7534, full: "Costa Rica", radius_km: 200 },
  myanmar: { lat: 21.9162, lon: 95.956, full: "Myanmar", radius_km: 400 },
  "united states": { lat: 39.8283, lon: -98.5795, full: "United States", radius_km: 1000 },
  us: { lat: 39.8283, lon: -98.5795, full: "United States", radius_km: 1000 },
  usa: { lat: 39.8283, lon: -98.5795, full: "United States", radius_km: 1000 },
};

/**
 * Extract region/location from event title — broader matching for non-city events.
 * Works for earthquake events that reference regions, countries, or fault lines.
 * e.g., "Will there be a 5.0+ earthquake in California this week?" → "California"
 */
export function extractRegionFromTitle(title: string): {
  region: string;
  lat: number;
  lon: number;
  radius_km: number;
} | null {
  const lower = title.toLowerCase();

  // Try direct region matches first (longest match wins)
  let bestMatch: { key: string; val: typeof REGION_COORDS[string] } | null = null;
  for (const [key, val] of Object.entries(REGION_COORDS)) {
    if (lower.includes(key)) {
      if (!bestMatch || key.length > bestMatch.key.length) {
        bestMatch = { key, val };
      }
    }
  }

  if (bestMatch) {
    return {
      region: bestMatch.val.full,
      lat: bestMatch.val.lat,
      lon: bestMatch.val.lon,
      radius_km: bestMatch.val.radius_km,
    };
  }

  // Also try city coords as fallback (some earthquake events mention cities)
  const cityResult = extractCityFromTitle(title);
  if (cityResult) {
    return {
      region: cityResult.city,
      lat: cityResult.lat,
      lon: cityResult.lon,
      radius_km: 250, // default earthquake search radius
    };
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

/* ─────────────────────────────────────────────
 * Generic threshold result used by all parsers
 * ───────────────────────────────────────────── */
export interface ParsedThreshold {
  rule_type: "above_below" | "range";
  /** Primary-unit values (cm, mm, km/h, Richter, °C) */
  threshold_low: number | null;
  threshold_high: number | null;
  /** Secondary-unit values (inches, mph, °F, etc.) — may be null */
  threshold_low_secondary: number | null;
  threshold_high_secondary: number | null;
  primary_unit: string;
  secondary_unit: string | null;
  label: string;
}

/* ─────────────────────────────────────────────
 * Snowfall parser
 * Patterns:
 *   "6 inches or more"  /  "less than 3 inches"
 *   "10-15 cm of snow"  /  "4-6 inches"
 * ───────────────────────────────────────────── */
const IN_TO_CM = 2.54;
const CM_TO_IN = 1 / IN_TO_CM;

export function parseSnowfallFromQuestion(q: string): ParsedThreshold | null {
  let m: RegExpMatchArray | null;

  // "X inches/cm or more/above"
  m = q.match(/(\d+(?:\.\d+)?)\s*(inches?|in|cm)\s+(?:of\s+\w+\s+)?or\s+(?:more|above|greater|higher)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const isCm = unit === "cm";
    const cm = isCm ? val : val * IN_TO_CM;
    const inches = isCm ? val * CM_TO_IN : val;
    return {
      rule_type: "above_below",
      threshold_low: Math.round(cm * 10) / 10,
      threshold_high: null,
      threshold_low_secondary: Math.round(inches * 10) / 10,
      threshold_high_secondary: null,
      primary_unit: "cm",
      secondary_unit: "in",
      label: `≥ ${Math.round(cm * 10) / 10} cm (≥ ${Math.round(inches * 10) / 10} in)`,
    };
  }

  // "less than X inches/cm" / "under X inches/cm" / "X inches/cm or less/below"
  m = q.match(/(?:less\s+than|under|below)\s+(\d+(?:\.\d+)?)\s*(inches?|in|cm)/i)
    || q.match(/(\d+(?:\.\d+)?)\s*(inches?|in|cm)\s+or\s+(?:less|below|fewer)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const isCm = unit === "cm";
    const cm = isCm ? val : val * IN_TO_CM;
    const inches = isCm ? val * CM_TO_IN : val;
    return {
      rule_type: "above_below",
      threshold_low: null,
      threshold_high: Math.round(cm * 10) / 10,
      threshold_low_secondary: null,
      threshold_high_secondary: Math.round(inches * 10) / 10,
      primary_unit: "cm",
      secondary_unit: "in",
      label: `≤ ${Math.round(cm * 10) / 10} cm (≤ ${Math.round(inches * 10) / 10} in)`,
    };
  }

  // Range: "X-Y inches/cm"
  m = q.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(inches?|in|cm)/i);
  if (m) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    const unit = m[3].toLowerCase();
    const isCm = unit === "cm";
    const loCm = isCm ? lo : lo * IN_TO_CM;
    const hiCm = isCm ? hi : hi * IN_TO_CM;
    const loIn = isCm ? lo * CM_TO_IN : lo;
    const hiIn = isCm ? hi * CM_TO_IN : hi;
    return {
      rule_type: "range",
      threshold_low: Math.round(loCm * 10) / 10,
      threshold_high: Math.round(hiCm * 10) / 10,
      threshold_low_secondary: Math.round(loIn * 10) / 10,
      threshold_high_secondary: Math.round(hiIn * 10) / 10,
      primary_unit: "cm",
      secondary_unit: "in",
      label: `${Math.round(loCm * 10) / 10}–${Math.round(hiCm * 10) / 10} cm (${Math.round(loIn * 10) / 10}–${Math.round(hiIn * 10) / 10} in)`,
    };
  }

  return null;
}

/* ─────────────────────────────────────────────
 * Rainfall parser
 * Patterns:
 *   "more than 10 mm"  /  "0.5 inches or more"
 *   "5-10 mm of rain"  /  "1-2 inches"
 * ───────────────────────────────────────────── */
const IN_TO_MM = 25.4;
const MM_TO_IN = 1 / IN_TO_MM;

export function parseRainfallFromQuestion(q: string): ParsedThreshold | null {
  let m: RegExpMatchArray | null;

  // "X mm/inches or more" / "more than X mm"
  m = q.match(/(\d+(?:\.\d+)?)\s*(mm|inches?|in)\s+(?:of\s+\w+\s+)?or\s+(?:more|above|greater)/i)
    || q.match(/(?:more\s+than|over|above|exceeds?)\s+(\d+(?:\.\d+)?)\s*(mm|inches?|in)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const isMm = unit === "mm";
    const mm = isMm ? val : val * IN_TO_MM;
    const inches = isMm ? val * MM_TO_IN : val;
    return {
      rule_type: "above_below",
      threshold_low: Math.round(mm * 10) / 10,
      threshold_high: null,
      threshold_low_secondary: Math.round(inches * 100) / 100,
      threshold_high_secondary: null,
      primary_unit: "mm",
      secondary_unit: "in",
      label: `≥ ${Math.round(mm * 10) / 10} mm (≥ ${Math.round(inches * 100) / 100} in)`,
    };
  }

  // "less than X mm" / "X mm or less"
  m = q.match(/(?:less\s+than|under|below)\s+(\d+(?:\.\d+)?)\s*(mm|inches?|in)/i)
    || q.match(/(\d+(?:\.\d+)?)\s*(mm|inches?|in)\s+or\s+(?:less|below|fewer)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const isMm = unit === "mm";
    const mm = isMm ? val : val * IN_TO_MM;
    const inches = isMm ? val * MM_TO_IN : val;
    return {
      rule_type: "above_below",
      threshold_low: null,
      threshold_high: Math.round(mm * 10) / 10,
      threshold_low_secondary: null,
      threshold_high_secondary: Math.round(inches * 100) / 100,
      primary_unit: "mm",
      secondary_unit: "in",
      label: `≤ ${Math.round(mm * 10) / 10} mm (≤ ${Math.round(inches * 100) / 100} in)`,
    };
  }

  // Range: "X-Y mm/inches"
  m = q.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(mm|inches?|in)/i);
  if (m) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    const unit = m[3].toLowerCase();
    const isMm = unit === "mm";
    const loMm = isMm ? lo : lo * IN_TO_MM;
    const hiMm = isMm ? hi : hi * IN_TO_MM;
    const loIn = isMm ? lo * MM_TO_IN : lo;
    const hiIn = isMm ? hi * MM_TO_IN : hi;
    return {
      rule_type: "range",
      threshold_low: Math.round(loMm * 10) / 10,
      threshold_high: Math.round(hiMm * 10) / 10,
      threshold_low_secondary: Math.round(loIn * 100) / 100,
      threshold_high_secondary: Math.round(hiIn * 100) / 100,
      primary_unit: "mm",
      secondary_unit: "in",
      label: `${Math.round(loMm * 10) / 10}–${Math.round(hiMm * 10) / 10} mm (${Math.round(loIn * 100) / 100}–${Math.round(hiIn * 100) / 100} in)`,
    };
  }

  return null;
}

/* ─────────────────────────────────────────────
 * Wind Speed parser (Storm category)
 * Patterns:
 *   "winds above 60 mph"  /  "gusts over 100 km/h"
 *   "50-70 mph"           /  "80 km/h or more"
 * ───────────────────────────────────────────── */
const MPH_TO_KMH = 1.60934;
const KMH_TO_MPH = 1 / MPH_TO_KMH;

export function parseWindSpeedFromQuestion(q: string): ParsedThreshold | null {
  let m: RegExpMatchArray | null;

  // "X mph/kmh or more" / "winds above X mph" / "gusts over X km/h"
  m = q.match(/(\d+(?:\.\d+)?)\s*(mph|km\/?h|kmh|kph)\s+or\s+(?:more|above|greater|higher|faster)/i)
    || q.match(/(?:above|over|exceeds?|faster\s+than)\s+(\d+(?:\.\d+)?)\s*(mph|km\/?h|kmh|kph)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase().replace("/", "");
    const isKmh = unit === "kmh" || unit === "kph";
    const kmh = isKmh ? val : val * MPH_TO_KMH;
    const mph = isKmh ? val * KMH_TO_MPH : val;
    return {
      rule_type: "above_below",
      threshold_low: Math.round(kmh * 10) / 10,
      threshold_high: null,
      threshold_low_secondary: Math.round(mph * 10) / 10,
      threshold_high_secondary: null,
      primary_unit: "km/h",
      secondary_unit: "mph",
      label: `≥ ${Math.round(kmh * 10) / 10} km/h (≥ ${Math.round(mph * 10) / 10} mph)`,
    };
  }

  // "less than X mph" / "under X km/h" / "X mph or less"
  m = q.match(/(?:less\s+than|under|below)\s+(\d+(?:\.\d+)?)\s*(mph|km\/?h|kmh|kph)/i)
    || q.match(/(\d+(?:\.\d+)?)\s*(mph|km\/?h|kmh|kph)\s+or\s+(?:less|below|slower)/i);
  if (m) {
    const val = parseFloat(m[1]);
    const unit = m[2].toLowerCase().replace("/", "");
    const isKmh = unit === "kmh" || unit === "kph";
    const kmh = isKmh ? val : val * MPH_TO_KMH;
    const mph = isKmh ? val * KMH_TO_MPH : val;
    return {
      rule_type: "above_below",
      threshold_low: null,
      threshold_high: Math.round(kmh * 10) / 10,
      threshold_low_secondary: null,
      threshold_high_secondary: Math.round(mph * 10) / 10,
      primary_unit: "km/h",
      secondary_unit: "mph",
      label: `≤ ${Math.round(kmh * 10) / 10} km/h (≤ ${Math.round(mph * 10) / 10} mph)`,
    };
  }

  // Range: "X-Y mph/kmh"
  m = q.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(mph|km\/?h|kmh|kph)/i);
  if (m) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    const unit = m[3].toLowerCase().replace("/", "");
    const isKmh = unit === "kmh" || unit === "kph";
    const loKmh = isKmh ? lo : lo * MPH_TO_KMH;
    const hiKmh = isKmh ? hi : hi * MPH_TO_KMH;
    const loMph = isKmh ? lo * KMH_TO_MPH : lo;
    const hiMph = isKmh ? hi * KMH_TO_MPH : hi;
    return {
      rule_type: "range",
      threshold_low: Math.round(loKmh * 10) / 10,
      threshold_high: Math.round(hiKmh * 10) / 10,
      threshold_low_secondary: Math.round(loMph * 10) / 10,
      threshold_high_secondary: Math.round(hiMph * 10) / 10,
      primary_unit: "km/h",
      secondary_unit: "mph",
      label: `${Math.round(loKmh * 10) / 10}–${Math.round(hiKmh * 10) / 10} km/h (${Math.round(loMph * 10) / 10}–${Math.round(hiMph * 10) / 10} mph)`,
    };
  }

  return null;
}

/* ─────────────────────────────────────────────
 * Earthquake Magnitude parser
 * Patterns:
 *   "magnitude 5.0 or greater"  /  "5.0+ earthquake"
 *   "between 4.0 and 5.0"       /  "magnitude 3.0-4.0"
 * ───────────────────────────────────────────── */
export function parseEarthquakeFromQuestion(q: string): ParsedThreshold | null {
  let m: RegExpMatchArray | null;

  // "magnitude X or greater/above/higher" / "X+ earthquake" / "at least X magnitude"
  m = q.match(/(?:magnitude|mag\.?)\s+(\d+(?:\.\d+)?)\s+or\s+(?:greater|above|higher|more)/i)
    || q.match(/(\d+(?:\.\d+)?)\+?\s*(?:magnitude|richter)?\s*(?:earthquake|quake|seismic)/i)
    || q.match(/(?:at\s+least|minimum|above|over|exceeds?)\s+(?:magnitude\s+)?(\d+(?:\.\d+)?)/i);
  if (m) {
    const val = parseFloat(m[1]);
    return {
      rule_type: "above_below",
      threshold_low: val,
      threshold_high: null,
      threshold_low_secondary: null,
      threshold_high_secondary: null,
      primary_unit: "M",
      secondary_unit: null,
      label: `≥ M${val}`,
    };
  }

  // "magnitude below/under X" / "less than magnitude X"
  m = q.match(/(?:magnitude|mag\.?)\s+(?:below|under|less\s+than)\s+(\d+(?:\.\d+)?)/i)
    || q.match(/(?:below|under|less\s+than)\s+(?:magnitude\s+)?(\d+(?:\.\d+)?)/i);
  if (m) {
    const val = parseFloat(m[1]);
    return {
      rule_type: "above_below",
      threshold_low: null,
      threshold_high: val,
      threshold_low_secondary: null,
      threshold_high_secondary: null,
      primary_unit: "M",
      secondary_unit: null,
      label: `≤ M${val}`,
    };
  }

  // Range: "between X and Y" / "magnitude X-Y" / "X.X to Y.Y"
  m = q.match(/(?:between|from)\s+(?:magnitude\s+)?(\d+(?:\.\d+)?)\s+(?:and|to)\s+(\d+(?:\.\d+)?)/i)
    || q.match(/(?:magnitude|mag\.?)\s+(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/i)
    || q.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:magnitude|richter|M)/i);
  if (m) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    return {
      rule_type: "range",
      threshold_low: lo,
      threshold_high: hi,
      threshold_low_secondary: null,
      threshold_high_secondary: null,
      primary_unit: "M",
      secondary_unit: null,
      label: `M${lo}–${hi}`,
    };
  }

  return null;
}

/* ─────────────────────────────────────────────
 * Climate anomaly parser (GISTEMP)
 * Handles brackets like:
 *   "1.20 to 1.29°C" → range
 *   "1.30°C or more"  → above_below (≥)
 *   "Less than 1.00°C" → above_below (≤)
 *   "1.20 to 1.29 ºC" → range (also ºC)
 * ───────────────────────────────────────────── */
export function parseClimateAnomalyFromQuestion(question: string): ParsedThreshold | null {
  const q = question.trim();
  let m: RegExpMatchArray | null;

  // "X or more" / "X°C or higher" / "at least X"
  m = q.match(/(\d+(?:\.\d+)?)\s*[°º]?C?\s*(?:or more|or higher|and above|\+)/i)
    || q.match(/(?:at least|above|over|more than|≥|>=)\s*(\d+(?:\.\d+)?)\s*[°º]?C?/i);
  if (m) {
    const val = parseFloat(m[1]);
    return {
      rule_type: "above_below",
      threshold_low: val,
      threshold_high: null,
      threshold_low_secondary: null,
      threshold_high_secondary: null,
      primary_unit: "°C",
      secondary_unit: null,
      label: `≥${val.toFixed(2)}°C`,
    };
  }

  // "Less than X" / "X or less" / "below X" / "under X"
  m = q.match(/(?:less than|below|under|≤|<=)\s*(\d+(?:\.\d+)?)\s*[°º]?C?/i)
    || q.match(/(\d+(?:\.\d+)?)\s*[°º]?C?\s*(?:or less|or lower|or below|and below)/i);
  if (m) {
    const val = parseFloat(m[1]);
    return {
      rule_type: "above_below",
      threshold_low: null,
      threshold_high: val,
      threshold_low_secondary: null,
      threshold_high_secondary: null,
      primary_unit: "°C",
      secondary_unit: null,
      label: `≤${val.toFixed(2)}°C`,
    };
  }

  // Range: "X to Y°C" / "X – Y°C" / "X to Y ºC"
  m = q.match(/(\d+(?:\.\d+)?)\s*(?:to|–|-)\s*(\d+(?:\.\d+)?)\s*[°º]?C?/i)
    || q.match(/(\d+(?:\.\d+)?)\s*[°º]?C?\s*(?:to|–|-)\s*(\d+(?:\.\d+)?)\s*[°º]?C?/i);
  if (m) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    return {
      rule_type: "range",
      threshold_low: lo,
      threshold_high: hi,
      threshold_low_secondary: null,
      threshold_high_secondary: null,
      primary_unit: "°C",
      secondary_unit: null,
      label: `${lo.toFixed(2)}–${hi.toFixed(2)}°C`,
    };
  }

  return null;
}

/* ─────────────────────────────────────────────
 * Unified dispatcher — routes to correct parser
 * based on Polymarket event category.
 * Falls back through parsers if category is unknown.
 * ───────────────────────────────────────────── */
export function parseThresholdFromQuestion(
  question: string,
  category: string
): ParsedThreshold | null {
  const cat = category.toLowerCase();

  if (cat === "snow") return parseSnowfallFromQuestion(question);
  if (cat === "rain") return parseRainfallFromQuestion(question);
  if (cat === "storm") return parseWindSpeedFromQuestion(question);
  if (cat === "earthquake") return parseEarthquakeFromQuestion(question);
  if (cat === "climateanomaly") return parseClimateAnomalyFromQuestion(question);

  // Temperature — wrap existing parser result into ParsedThreshold shape
  if (cat === "temperature") {
    const t = parseTemperatureFromQuestion(question);
    if (!t) return null;
    return {
      rule_type: t.rule_type,
      threshold_low: t.threshold_low_c,
      threshold_high: t.threshold_high_c,
      threshold_low_secondary: t.threshold_low_f,
      threshold_high_secondary: t.threshold_high_f,
      primary_unit: "°C",
      secondary_unit: "°F",
      label: t.label,
    };
  }

  // Unknown category — try all parsers as cascade
  return (
    parseClimateAnomalyFromQuestion(question) ||
    parseSnowfallFromQuestion(question) ||
    parseRainfallFromQuestion(question) ||
    parseWindSpeedFromQuestion(question) ||
    parseEarthquakeFromQuestion(question) ||
    (() => {
      const t = parseTemperatureFromQuestion(question);
      if (!t) return null;
      return {
        rule_type: t.rule_type,
        threshold_low: t.threshold_low_c,
        threshold_high: t.threshold_high_c,
        threshold_low_secondary: t.threshold_low_f,
        threshold_high_secondary: t.threshold_high_f,
        primary_unit: "°C",
        secondary_unit: "°F",
        label: t.label,
      } as ParsedThreshold;
    })()
  );
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
  // CLOB trading identifiers
  clob_token_id_yes: string | null;
  clob_token_id_no: string | null;
  condition_id: string | null;
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
  neg_risk: boolean;
  sub_markets: ParsedSubMarket[];
  raw_event: Record<string, unknown>;
}
