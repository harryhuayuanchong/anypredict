import { NextResponse } from "next/server";
import {
  buildRuleBasedSummary,
  hashPayload,
  parseSummaryResponse,
} from "@/lib/leaderboard/ai-summary";
import type { AiSummary, SummaryPayload } from "@/lib/leaderboard/types";
import { createServerClient } from "@/lib/supabase";

type Row = {
  wallet_address: string;
  data_hash: string;
  summary: AiSummary;
  source: "model" | "rule_based";
  updated_at: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = body?.payload as SummaryPayload | undefined;
    const wallet = String(body?.wallet || "").toLowerCase();

    if (!wallet || !payload) {
      return NextResponse.json({ error: "wallet and payload are required" }, { status: 400 });
    }

    const dataHash = hashPayload(payload);
    const supabase = getSupabase();

    if (supabase) {
      const cached = await supabase
        .from("wallet_ai_summaries")
        .select("wallet_address,data_hash,summary,source,updated_at")
        .eq("wallet_address", wallet)
        .eq("data_hash", dataHash)
        .maybeSingle<Row>();

      if (cached.data?.summary) {
        return NextResponse.json({
          summary: cached.data.summary,
          cached: true,
          source: cached.data.source,
          updatedAt: cached.data.updated_at,
        });
      }
    }

    const modelSummary = await generateModelSummary(payload);
    const summary = modelSummary ?? buildRuleBasedSummary(payload);
    const source = modelSummary ? "model" : "rule_based";

    if (supabase) {
      await supabase.from("wallet_ai_summaries").upsert(
        {
          wallet_address: wallet,
          data_hash: dataHash,
          summary,
          source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" }
      );
    }

    return NextResponse.json({
      summary,
      cached: false,
      source,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Failed to generate AI summary" }, { status: 500 });
  }
}

function getSupabase() {
  try {
    return createServerClient();
  } catch {
    return null;
  }
}

async function generateModelSummary(payload: SummaryPayload): Promise<AiSummary | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const prompt = `
You are generating concise wallet behavior summaries for a trading dashboard.
Return only strict JSON with keys:
- performanceSnapshot
- holdingBehavior
- tradePattern
- categoryEdge

Constraints:
- Max 1 sentence per key.
- Use plain English and concrete numbers.
- No markdown.

Wallet payload:
${JSON.stringify(payload)}
  `.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a precise trading analyst." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) return null;

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  return parseSummaryResponse(content);
}
