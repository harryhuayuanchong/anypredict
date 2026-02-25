import type { LabelEntry, LeaderboardRow } from "./types";

// ── Constants ──────────────────────────────────────────

export const API_BASE = "https://data-api.polymarket.com";
export const LABELS_API_BASE = "https://api.walletlabels.xyz/api";
export const DETAILS_LIMIT = 20;
export const DETAILS_TTL_MS = 5 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 8000;
export const WATCHLIST_CLIENT_KEY = "watchlistClientId";

export const SMART_MONEY_ALLOWLIST = new Set<string>([
  "0x0000000000000000000000000000000000000000",
]);

export const SMART_MONEY_KEYWORDS = [
  "market maker",
  "mm",
  "fund",
  "capital",
  "hedge",
  "prop",
  "proprietary",
  "trading",
  "trader",
  "arbitrage",
  "quant",
  "whale",
  "treasury",
  "dao",
  "vc",
  "venture",
];

export const CATEGORIES = [
  { value: "OVERALL", label: "Overall" },
  { value: "POLITICS", label: "Politics" },
  { value: "SPORTS", label: "Sports" },
  { value: "CLIMATE", label: "Climate" },
  { value: "GEOPOLITICS", label: "Geopolitics" },
  { value: "TECH", label: "Tech" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "ECONOMICS", label: "Economics" },
  { value: "CULTURE", label: "Culture" },
] as const;

export const TIME_PERIODS = [
  { value: "DAY", label: "1 Day" },
  { value: "WEEK", label: "7 Days" },
  { value: "MONTH", label: "1 Month" },
  { value: "ALL", label: "All Time" },
] as const;

// ── Pure Functions ──────────────────────────────────────

export function shortAddress(address?: string | null) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function normalizeUsername(name: string | null, address: string | null) {
  if (!name) return shortAddress(address);
  const normalized = name.trim();
  const match = normalized.match(/^(0x[a-fA-F0-9]{40})(?:-.+)?$/);
  if (match) return shortAddress(match[1]);
  return normalized;
}

export function extractWalletAddress(input?: string | null) {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(normalized)) return normalized;
  const match = normalized.match(/^(0x[a-f0-9]{40})(?:-.+)?$/);
  return match ? match[1] : null;
}

export function formatCurrency(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(dateValue: unknown) {
  if (!dateValue) return "—";
  const date = new Date(dateValue as string | number);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function toTimestamp(value: unknown) {
  const time = new Date((value as string | number) || 0).getTime();
  if (!Number.isNaN(time) && time > 0) return time;
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

// ── Smart Money ─────────────────────────────────────────

export function summarizeLabels(labels: LabelEntry[]) {
  const labelText = labels
    .map((l) =>
      [l.address_name, l.label, l.label_type, l.label_subtype]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    )
    .join(" ");
  return SMART_MONEY_KEYWORDS.some((kw) => labelText.includes(kw));
}

export function classifySmartMoney(row: LeaderboardRow, labels: LabelEntry[]) {
  const labelMatch = summarizeLabels(labels);
  const volume = row.volume || 0;
  const pnl = row.pnl || 0;
  const pnlToVolume = volume > 0 ? pnl / volume : 0;
  const strongPnlRule = pnl >= 5000 && volume >= 10000 && pnlToVolume >= 0.1;
  const topRankRule = row.rank !== null && row.rank <= 5 && pnl > 0;
  return labelMatch || strongPnlRule || topRankRule;
}

export type SmartMoneyTag = {
  label: string;
  color: "blue" | "purple" | "green" | "orange" | "red" | "yellow" | "cyan";
};

const LABEL_TAG_RULES: { keywords: string[]; tag: string; color: SmartMoneyTag["color"] }[] = [
  { keywords: ["whale"], tag: "Whale", color: "cyan" },
  { keywords: ["market maker", "mm"], tag: "Market Maker", color: "purple" },
  { keywords: ["fund", "capital", "hedge"], tag: "Fund", color: "blue" },
  { keywords: ["vc", "venture"], tag: "VC", color: "orange" },
  { keywords: ["dao", "treasury"], tag: "DAO", color: "yellow" },
  { keywords: ["quant", "arbitrage"], tag: "Quant", color: "green" },
  { keywords: ["prop", "proprietary"], tag: "Prop Firm", color: "purple" },
];

export function getSmartMoneyTags(row: LeaderboardRow): SmartMoneyTag[] {
  const tags: SmartMoneyTag[] = [];

  // Tags from wallet labels
  const labelText = row.labels
    .map((l) =>
      [l.address_name, l.label, l.label_type, l.label_subtype]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    )
    .join(" ");

  for (const rule of LABEL_TAG_RULES) {
    if (rule.keywords.some((kw) => labelText.includes(kw))) {
      tags.push({ label: rule.tag, color: rule.color });
    }
  }

  // Performance-based tags
  const volume = row.volume || 0;
  const pnl = row.pnl || 0;
  const pnlToVolume = volume > 0 ? pnl / volume : 0;

  if (row.rank !== null && row.rank <= 5 && pnl > 0) {
    tags.push({ label: "Top 5", color: "yellow" });
  }

  if (pnl >= 5000 && volume >= 10000 && pnlToVolume >= 0.1) {
    tags.push({ label: "High ROI", color: "green" });
  }

  if (volume >= 100000) {
    tags.push({ label: "High Volume", color: "blue" });
  }

  if (pnl < -5000) {
    tags.push({ label: "Degen", color: "red" });
  }

  return tags;
}

// ── Category Inference ──────────────────────────────────

export function inferCategoryFromData(positions: Record<string, unknown>[], activity: Record<string, unknown>[]): string | null {
  const corpus = [
    ...positions.map((p) => String(p?.title || p?.outcome || (p?.market as Record<string, unknown>)?.question || "")),
    ...activity.map((a) => String(a?.title || a?.name || a?.eventTitle || "")),
  ]
    .join(" ")
    .toLowerCase();

  if (!corpus) return null;

  const rules = [
    { category: "Politics", words: ["election", "president", "senate", "vote", "campaign", "congress", "party"] },
    { category: "Sports", words: ["fc", "nba", "nfl", "mlb", "score", "match", "vs", "goal", "championship"] },
    { category: "Climate", words: ["hurricane", "rainfall", "temperature", "snow", "climate", "weather", "drought", "flood"] },
    { category: "Geopolitics", words: ["war", "sanctions", "nato", "treaty", "conflict", "diplomacy", "tariff", "invasion"] },
    { category: "Tech", words: ["ai", "openai", "apple", "google", "tesla", "nvidia", "software", "chip"] },
    { category: "Crypto", words: ["btc", "bitcoin", "eth", "ethereum", "solana", "token", "defi", "nft"] },
    { category: "Economics", words: ["inflation", "fed", "rate", "cpi", "gdp", "recession", "stock", "nasdaq", "earnings"] },
    { category: "Culture", words: ["movie", "oscar", "grammy", "celebrity", "music", "award", "film"] },
  ];

  let best: { category: string; score: number } | null = null;
  for (const rule of rules) {
    let score = 0;
    for (const word of rule.words) {
      if (corpus.includes(word)) score += 1;
    }
    if (!best || score > best.score) best = { category: rule.category, score };
  }

  if (!best || best.score === 0) return null;
  return best.category;
}

// ── Fetch with Timeout ──────────────────────────────────

export async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

// ── CSV Export ───────────────────────────────────────────

export function exportCsv(rows: (string | number | null | undefined)[][], headers: string[], filename: string) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    const line = row.map((value) => {
      if (value === null || value === undefined) return "";
      const text = String(value);
      if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    });
    lines.push(line.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
