import { NextResponse } from "next/server";

export interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  end_date: string | null;
  volume: number;
  liquidity: number;
  active: boolean;
  closed: boolean;
  market_count: number;
  category: string | null;
  image: string | null;
  url: string;
}

/**
 * Fetch weather events from Polymarket Gamma API.
 * Queries both the "Weather" (tag 84) and "Daily Temperature" (tag 103040) categories,
 * then merges and deduplicates.
 */
export async function GET() {
  try {
    const tagIds = [84, 103040]; // Weather + Daily Temperature

    // Fetch all tags in parallel
    const results = await Promise.all(
      tagIds.map(async (tagId) => {
        const url = `https://gamma-api.polymarket.com/events?closed=false&limit=50&order=volume&ascending=false&tag_id=${tagId}&related_tags=true`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          next: { revalidate: 300 }, // Cache for 5 minutes
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      })
    );

    // Merge and deduplicate by event ID
    const seen = new Set<string>();
    const events: PolymarketEvent[] = [];

    for (const list of results) {
      for (const event of list) {
        const id = event.id?.toString() || event.slug;
        if (seen.has(id)) continue;
        seen.add(id);

        const marketCount = Array.isArray(event.markets)
          ? event.markets.length
          : 0;

        events.push({
          id,
          title: event.title || "",
          slug: event.slug || "",
          description: event.description || "",
          end_date: event.endDate || event.end_date || null,
          volume: parseFloat(event.volume) || 0,
          liquidity: parseFloat(event.liquidity) || 0,
          active: event.active ?? true,
          closed: event.closed ?? false,
          market_count: marketCount,
          category: detectCategory(event.title || ""),
          image: event.image || null,
          url: `https://polymarket.com/event/${event.slug}`,
        });
      }
    }

    // Sort by volume descending
    events.sort((a, b) => b.volume - a.volume);

    return NextResponse.json({ events, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error("Events fetch error:", err);
    return NextResponse.json(
      { error: `Failed to fetch events: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

/** Detect event category from title */
function detectCategory(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("temperature") || lower.includes("highest temp") || lower.includes("lowest temp")) {
    return "Temperature";
  }
  if (lower.includes("snow") || lower.includes("snowfall")) {
    return "Snow";
  }
  if (lower.includes("earthquake")) {
    return "Earthquake";
  }
  if (lower.includes("hurricane") || lower.includes("storm") || lower.includes("cyclone")) {
    return "Storm";
  }
  if (lower.includes("rain") || lower.includes("precipitation")) {
    return "Rain";
  }
  if (lower.includes("hottest") || lower.includes("warmest") || lower.includes("coldest")) {
    return "Climate";
  }
  return "Weather";
}
