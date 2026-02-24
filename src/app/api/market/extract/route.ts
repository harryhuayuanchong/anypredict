import { NextRequest, NextResponse } from "next/server";
import {
  extractSlugFromUrl,
  extractCityFromTitle,
  parseTemperatureFromQuestion,
  type ExtractedEvent,
  type ParsedSubMarket,
} from "@/lib/polymarket";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "Missing URL" }, { status: 400 });
    }

    // 1. Extract slug from URL
    const slug = extractSlugFromUrl(url);
    if (!slug) {
      return NextResponse.json(
        { error: "Could not parse Polymarket event slug from URL. Expected format: https://polymarket.com/event/some-slug" },
        { status: 400 }
      );
    }

    // 2. Fetch event from Gamma API
    const gammaUrl = `https://gamma-api.polymarket.com/events/slug/${slug}`;
    const res = await fetch(gammaUrl, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json(
          { error: `Event not found for slug: ${slug}` },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Polymarket API error: ${res.status}` },
        { status: 502 }
      );
    }

    const event = await res.json();

    // 3. Extract city/location from title
    const cityInfo = extractCityFromTitle(event.title || "");

    // 4. Parse sub-markets
    const markets = event.markets || [];
    const subMarkets: ParsedSubMarket[] = [];

    for (const m of markets) {
      const question = m.question || m.groupItemTitle || "";
      const parsed = parseTemperatureFromQuestion(question);

      // Parse outcome prices
      let yesPrice = 0.5;
      let noPrice = 0.5;
      try {
        if (m.outcomePrices) {
          const prices =
            typeof m.outcomePrices === "string"
              ? JSON.parse(m.outcomePrices)
              : m.outcomePrices;
          yesPrice = parseFloat(prices[0]) || 0.5;
          noPrice = parseFloat(prices[1]) || 0.5;
        }
      } catch {
        // fallback to defaults
      }

      // Parse CLOB token IDs for trading
      let clobYes: string | null = null;
      let clobNo: string | null = null;
      try {
        if (m.clobTokenIds) {
          const tokenIds =
            typeof m.clobTokenIds === "string"
              ? JSON.parse(m.clobTokenIds)
              : m.clobTokenIds;
          if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
            clobYes = tokenIds[0] || null;
            clobNo = tokenIds[1] || null;
          }
        }
      } catch {
        // token IDs not available
      }

      const conditionId = m.conditionId || null;

      if (parsed) {
        subMarkets.push({
          id: m.id || m.conditionId || "",
          question,
          yes_price: yesPrice,
          no_price: noPrice,
          rule_type: parsed.rule_type,
          threshold_low_c: parsed.threshold_low_c,
          threshold_high_c: parsed.threshold_high_c,
          threshold_low_f: parsed.threshold_low_f,
          threshold_high_f: parsed.threshold_high_f,
          unit: parsed.unit,
          label: parsed.label,
          liquidity: parseFloat(m.liquidity) || 0,
          volume: parseFloat(m.volume) || 0,
          clob_token_id_yes: clobYes,
          clob_token_id_no: clobNo,
          condition_id: conditionId,
        });
      } else {
        // Include even if we can't parse temps — user can fill manually
        subMarkets.push({
          id: m.id || m.conditionId || "",
          question,
          yes_price: yesPrice,
          no_price: noPrice,
          rule_type: "range",
          threshold_low_c: null,
          threshold_high_c: null,
          threshold_low_f: null,
          threshold_high_f: null,
          unit: "?",
          label: question,
          liquidity: parseFloat(m.liquidity) || 0,
          volume: parseFloat(m.volume) || 0,
          clob_token_id_yes: clobYes,
          clob_token_id_no: clobNo,
          condition_id: conditionId,
        });
      }
    }

    // Sort sub-markets by threshold (ascending)
    subMarkets.sort((a, b) => {
      const aVal = a.threshold_low_f ?? a.threshold_high_f ?? 0;
      const bVal = b.threshold_low_f ?? b.threshold_high_f ?? 0;
      return aVal - bVal;
    });

    const result: ExtractedEvent = {
      event_title: event.title || slug,
      event_slug: slug,
      event_url: url,
      description: event.description || "",
      end_date: event.endDate || event.end_date || null,
      resolution_source: event.resolutionSource || null,
      city: cityInfo?.city || null,
      lat: cityInfo?.lat || null,
      lon: cityInfo?.lon || null,
      neg_risk: !!event.negRisk,
      sub_markets: subMarkets,
      raw_event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        endDate: event.endDate,
        category: event.category,
        negRisk: event.negRisk,
        liquidity: event.liquidity,
        volume: event.volume,
      },
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Market extract error:", err);
    return NextResponse.json(
      {
        error: `Failed to extract market data: ${
          err instanceof Error ? err.message : err
        }`,
      },
      { status: 500 }
    );
  }
}
