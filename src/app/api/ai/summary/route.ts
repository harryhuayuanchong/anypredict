import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const { run_id } = await request.json();

    if (!run_id) {
      return NextResponse.json({ error: "Missing run_id" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 501 }
      );
    }

    const supabase = createServerClient();
    const { data: run, error } = await supabase
      .from("weather_strategy_runs")
      .select("*")
      .eq("id", run_id)
      .single();

    if (error || !run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const tradePlan = run.trade_plan as {
      recommended_side: string;
      rationale: string[];
      assumptions: string[];
      invalidated_if: string[];
      suggested_size_usd: number;
      kelly_fraction?: number;
      kelly_size_usd?: number;
      half_kelly_size_usd?: number;
    };

    const prompt = `You are a prediction market analyst. Analyze this weather strategy run and provide a structured summary.

Use this exact format (with markdown bold for labels):

Write a 2-3 sentence analysis paragraph. Focus on the key insight — why the model agrees or disagrees with the market, and whether the edge is actionable.

**Key Risks**
1. **Risk Name:** Brief explanation
2. **Risk Name:** Brief explanation
3. **Risk Name:** Brief explanation

**Verdict**
One sentence: is this a good trade or not, and why.

---
Market: ${run.market_title}
Location: ${run.location_text}
Resolution: ${run.resolution_time}
Rule: ${run.rule_type} (thresholds: ${run.threshold_low ?? "N/A"} to ${run.threshold_high ?? "N/A"})
Forecast temp: ${run.forecast_snapshot?.forecast_temp ?? "N/A"}°C
Model probability: ${((run.model_prob ?? 0) * 100).toFixed(1)}%
Market implied: ${((run.market_implied_prob ?? 0) * 100).toFixed(1)}%
Edge: ${((run.edge ?? 0) * 100).toFixed(2)}%
Recommendation: ${run.recommendation}
Probability method: ${run.forecast_snapshot?.prob_method ?? "normal"}${run.forecast_snapshot?.prob_method === "ensemble" ? ` (${run.forecast_snapshot.ensemble_member_count} members, ${run.forecast_snapshot.ensemble_model})` : ""}
${run.forecast_snapshot?.ensemble_p10 != null ? `Ensemble P10/P50/P90: ${run.forecast_snapshot.ensemble_p10}°C / ${run.forecast_snapshot.ensemble_p50}°C / ${run.forecast_snapshot.ensemble_p90}°C` : ""}
Kelly fraction: ${tradePlan?.kelly_fraction != null ? `${(tradePlan.kelly_fraction * 100).toFixed(1)}%` : "N/A"}
Suggested size: $${tradePlan?.suggested_size_usd?.toFixed(2) ?? "0"}
Rationale: ${tradePlan?.rationale?.join("; ")}`;

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { error: `OpenAI error: ${res.status} ${errBody}` },
        { status: 502 }
      );
    }

    const completion = await res.json();
    const summary = completion.choices?.[0]?.message?.content ?? "";

    // Save summary back to the run
    await supabase
      .from("weather_strategy_runs")
      .update({ ai_summary: summary })
      .eq("id", run_id);

    return NextResponse.json({ summary });
  } catch (err) {
    return NextResponse.json(
      { error: `AI summary failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
