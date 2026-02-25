"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AiSummary,
  CacheEntry,
  ChartPoint,
  HistoryItem,
  LeaderboardRow,
  PositionItem,
  PositionSummaryData,
  TradeSummaryData,
  WalletModalData,
} from "./types";
import {
  API_BASE,
  DETAILS_TTL_MS,
  fetchWithTimeout,
  formatCurrency,
  formatDate,
  inferCategoryFromData,
  shortAddress,
  toTimestamp,
} from "./utils";

const EMPTY_AI: AiSummary = {
  performanceSnapshot: "",
  holdingBehavior: "",
  tradePattern: "",
  categoryEdge: "",
};

const INITIAL_MODAL: WalletModalData = {
  name: "Wallet",
  joined: "Joined —",
  addressShort: "0x…",
  address: "",
  lifetimePnl: "—",
  lifetimeVol: "—",
  lifetimePnlNeg: false,
  positionsCount: "—",
  positionsValue: "—",
  tradesCount: "—",
  tradeSummary: null,
  positionSummary: null,
  positions: [],
  history: [],
  chartPoints: [],
  chartValue: "$0.00",
  aiSummaryLoading: true,
  aiSummaryError: "",
  aiSummarySource: "",
  aiSummaryUpdatedAt: "",
  aiSummaryCategory: "",
  aiSummaryEvent: "",
  aiSummary: EMPTY_AI,
};

export function useWalletModal() {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<WalletModalData>(INITIAL_MODAL);

  const activeRef = useRef<string | null>(null);
  const profileCache = useRef<Map<string, CacheEntry<Record<string, unknown>>>>(new Map());
  const valueCache = useRef<Map<string, CacheEntry<Record<string, unknown>>>>(new Map());
  const positionsCache = useRef<Map<string, CacheEntry<Record<string, unknown>[]>>>(new Map());
  const activityCache = useRef<Map<string, CacheEntry<Record<string, unknown>[]>>>(new Map());
  const closedCache = useRef<Map<string, CacheEntry<Record<string, unknown>[]>>>(new Map());

  // ── Fetchers ──────────────────────────────────────────

  async function fetchProfile(address: string) {
    const normalized = address.toLowerCase();
    const cached = profileCache.current.get(normalized);
    if (cached && Date.now() - cached.timestamp < DETAILS_TTL_MS) return cached.value;

    const url = new URL("/api/leaderboard/public-profile", window.location.origin);
    url.searchParams.set("address", address);

    const response = await fetchWithTimeout(url.toString()).catch(() => null);
    if (!response || !response.ok) return null;
    const data = await response.json();
    profileCache.current.set(normalized, { value: data, timestamp: Date.now() });
    return data;
  }

  async function fetchValue(address: string) {
    const normalized = address.toLowerCase();
    const cached = valueCache.current.get(normalized);
    if (cached && Date.now() - cached.timestamp < DETAILS_TTL_MS) return cached.value;

    const url = new URL(`${API_BASE}/value`);
    url.searchParams.set("user", address);

    const response = await fetchWithTimeout(url.toString()).catch(() => null);
    if (!response || !response.ok) return null;
    const data = await response.json();
    const entry = Array.isArray(data) ? data[0] : data;
    valueCache.current.set(normalized, { value: entry, timestamp: Date.now() });
    return entry;
  }

  async function fetchPositions(address: string) {
    const normalized = address.toLowerCase();
    const cached = positionsCache.current.get(normalized);
    if (cached && Date.now() - cached.timestamp < DETAILS_TTL_MS) return cached.value;

    const url = new URL(`${API_BASE}/positions`);
    url.searchParams.set("user", address);
    url.searchParams.set("limit", "100");
    url.searchParams.set("sizeThreshold", "1");

    const response = await fetchWithTimeout(url.toString()).catch(() => null);
    if (!response || !response.ok) return [];
    const data = await response.json();
    const positions = Array.isArray(data) ? data : [];
    positionsCache.current.set(normalized, { value: positions, timestamp: Date.now() });
    return positions;
  }

  async function fetchActivity(address: string, limit = 200) {
    const normalized = address.toLowerCase();
    const cached = activityCache.current.get(normalized);
    if (cached && Date.now() - cached.timestamp < DETAILS_TTL_MS) return cached.value;

    const url = new URL(`${API_BASE}/activity`);
    url.searchParams.set("user", address);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sortBy", "TIMESTAMP");
    url.searchParams.set("sortDirection", "DESC");

    const response = await fetchWithTimeout(url.toString()).catch(() => null);
    if (!response || !response.ok) return [];
    const data = await response.json();
    const activity = Array.isArray(data) ? data : [];
    activityCache.current.set(normalized, { value: activity, timestamp: Date.now() });
    return activity;
  }

  async function fetchClosedPositions(address: string) {
    const normalized = address.toLowerCase();
    const cached = closedCache.current.get(normalized);
    if (cached && Date.now() - cached.timestamp < DETAILS_TTL_MS) return cached.value;

    const url = new URL(`${API_BASE}/closed-positions`);
    url.searchParams.set("user", address);
    url.searchParams.set("limit", "50");
    url.searchParams.set("sortBy", "TIMESTAMP");
    url.searchParams.set("sortDirection", "ASC");

    const response = await fetchWithTimeout(url.toString()).catch(() => null);
    if (!response || !response.ok) return [];
    const data = await response.json();
    const positions = Array.isArray(data) ? data : [];
    closedCache.current.set(normalized, { value: positions, timestamp: Date.now() });
    return positions;
  }

  // ── Transform helpers ─────────────────────────────────

  function buildTradeSummary(activity: Record<string, unknown>[]): TradeSummaryData | null {
    if (!activity.length) return null;
    const trades = activity.filter((a) => a?.type === "TRADE");
    return {
      totalTrades: trades.length,
      buys: trades.filter((a) => a?.side === "BUY").length,
      sells: trades.filter((a) => a?.side === "SELL").length,
      volume: trades.reduce((s, a) => s + Number(a?.usdcSize ?? 0), 0),
    };
  }

  function buildPositionSummary(positions: Record<string, unknown>[], totalValue: number): PositionSummaryData | null {
    if (!positions.length) return null;
    const sorted = [...positions].sort(
      (a, b) => Number(b?.currentValue ?? b?.value ?? 0) - Number(a?.currentValue ?? a?.value ?? 0)
    );
    const top = sorted[0];
    return {
      openPositions: positions.length,
      totalValue,
      largestTitle: (top?.title as string) || "Unknown market",
      largestValue: Number(top?.currentValue ?? top?.value ?? 0),
    };
  }

  function buildPositionItems(positions: Record<string, unknown>[]): PositionItem[] {
    return positions.slice(0, 6).map((p) => ({
      title: (p?.title as string) || "Unknown market",
      outcome: (p?.outcome as string) || ((p?.token as Record<string, unknown>)?.outcome as string) || "—",
      value: Number(p?.currentValue ?? p?.value ?? 0),
      pnl: Number(p?.cashPnl ?? p?.pnl ?? 0),
      market: ((p?.market as Record<string, unknown>)?.question as string) || undefined,
      shares: p?.shares != null ? Number(p.shares) : p?.size != null ? Number(p.size) : undefined,
    }));
  }

  function buildHistoryItems(activity: Record<string, unknown>[]): HistoryItem[] {
    return activity.slice(0, 10).map((a) => ({
      title: (a?.title || a?.name || a?.eventTitle) as string || "Unknown market",
      side: (a?.side || a?.direction || a?.type) as string || "—",
      size: Number(a?.usdcSize ?? a?.size ?? 0),
      time: formatDate(a?.timestamp || a?.createdAt),
      status: (a?.status as string) || undefined,
      market: (a?.market as string) || undefined,
    }));
  }

  function buildChartPoints(closedPositions: Record<string, unknown>[]): { points: ChartPoint[]; lastValue: string } {
    if (!closedPositions.length) return { points: [], lastValue: "$0.00" };

    const series = closedPositions
      .map((p) => ({
        timestamp: toTimestamp(p?.timestamp || p?.closedAt || p?.closedTimestamp),
        pnl: Number(p?.realizedPnl ?? p?.pnl ?? 0),
      }))
      .filter((p) => !Number.isNaN(p.timestamp) && p.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!series.length) return { points: [], lastValue: "$0.00" };

    let cumulative = 0;
    const points = series.map((s) => {
      cumulative += s.pnl;
      return { time: s.timestamp, value: cumulative };
    });

    return { points, lastValue: formatCurrency(points[points.length - 1]?.value ?? 0) };
  }

  // ── Open Modal ────────────────────────────────────────

  const openModal = useCallback(async (row: LeaderboardRow) => {
    if (!row.address) return;
    activeRef.current = row.address;
    setModalOpen(true);
    setModalData({
      ...INITIAL_MODAL,
      name: row.name || shortAddress(row.address),
      addressShort: shortAddress(row.address),
      address: row.address,
    });

    const results = await Promise.allSettled([
      fetchProfile(row.address),
      fetchValue(row.address),
      fetchPositions(row.address),
      fetchActivity(row.address, 200),
      fetchClosedPositions(row.address),
    ]);

    if (activeRef.current !== row.address) return;

    const profile = results[0].status === "fulfilled" ? results[0].value : null;
    const value = results[1].status === "fulfilled" ? results[1].value : null;
    const positions = (results[2].status === "fulfilled" ? results[2].value : []) as Record<string, unknown>[];
    const activity = (results[3].status === "fulfilled" ? results[3].value : []) as Record<string, unknown>[];
    const closedPositions = (results[4].status === "fulfilled" ? results[4].value : []) as Record<string, unknown>[];

    const profileName =
      (profile as Record<string, unknown>)?.name ||
      (profile as Record<string, unknown>)?.username ||
      (profile as Record<string, unknown>)?.displayName ||
      row.name ||
      shortAddress(row.address);
    const joined =
      (profile as Record<string, unknown>)?.createdAt ||
      (profile as Record<string, unknown>)?.created_at ||
      (profile as Record<string, unknown>)?.created;

    const positionsValue =
      Number(
        (value as Record<string, unknown>)?.totalValue ??
        (value as Record<string, unknown>)?.value ??
        (value as Record<string, unknown>)?.portfolioValue ?? 0
      ) ||
      positions.reduce((sum, p) => sum + Number(p?.currentValue ?? p?.value ?? 0), 0);

    const trades = activity.filter((a) => a?.type === "TRADE");
    const volume = trades.reduce((sum, a) => sum + Number(a?.usdcSize ?? 0), 0);
    const realized = closedPositions.reduce((sum, p) => sum + Number(p?.realizedPnl ?? p?.pnl ?? 0), 0);

    const wins = closedPositions.filter((p) => Number(p?.realizedPnl ?? p?.pnl ?? 0) > 0).length;
    const losses = closedPositions.filter((p) => Number(p?.realizedPnl ?? p?.pnl ?? 0) < 0).length;
    const totalClosed = wins + losses;
    const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : null;

    const sortedByValue = [...positions].sort(
      (a, b) => Number(b?.currentValue ?? b?.value ?? 0) - Number(a?.currentValue ?? a?.value ?? 0)
    );
    const topPosition = sortedByValue[0];
    const topPositionTitle = (topPosition?.title as string) || null;
    const topPositionValue = Number(topPosition?.currentValue ?? topPosition?.value ?? 0) || 0;
    const inferredCategory = inferCategoryFromData(positions, activity);
    const categoryHint =
      (topPosition?.category as string) ||
      ((topPosition?.market as Record<string, unknown>)?.category as string) ||
      ((topPosition?.tags as string[]) ?? [])[0] ||
      null;
    const bestCategory = categoryHint || inferredCategory;

    const { points, lastValue } = buildChartPoints(closedPositions);

    setModalData((prev) => ({
      ...prev,
      name: profileName as string,
      joined: joined ? `Joined ${formatDate(joined)}` : "Joined —",
      addressShort: shortAddress(row.address),
      address: row.address!,
      lifetimePnl: formatCurrency(realized),
      lifetimeVol: formatCurrency(volume),
      lifetimePnlNeg: realized < 0,
      positionsCount: positions.length.toString(),
      positionsValue: formatCurrency(positionsValue),
      tradesCount: trades.length.toString(),
      tradeSummary: buildTradeSummary(activity),
      positionSummary: buildPositionSummary(positions, positionsValue),
      positions: buildPositionItems(positions),
      history: buildHistoryItems(activity),
      chartPoints: points,
      chartValue: lastValue,
    }));

    // Fetch AI summary
    try {
      const aiResponse = await fetch("/api/leaderboard/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: row.address,
          payload: {
            walletAddress: row.address,
            realizedPnl: realized,
            lifetimeVolume: volume,
            openPositions: positions.length,
            openPositionsValue: positionsValue,
            trades: trades.length,
            buys: trades.filter((a) => a?.side === "BUY").length,
            sells: trades.filter((a) => a?.side === "SELL").length,
            topPositionTitle,
            topPositionValue,
            winRate,
            categoryHint: bestCategory,
          },
        }),
      });

      if (activeRef.current !== row.address) return;

      if (!aiResponse.ok) throw new Error("AI summary failed");
      const aiData = await aiResponse.json();

      setModalData((prev) => ({
        ...prev,
        aiSummaryLoading: false,
        aiSummaryError: "",
        aiSummarySource: aiData?.source || "",
        aiSummaryUpdatedAt: aiData?.updatedAt || "",
        aiSummaryCategory: bestCategory || "",
        aiSummaryEvent: topPositionTitle || "",
        aiSummary: aiData?.summary || prev.aiSummary,
      }));
    } catch {
      if (activeRef.current !== row.address) return;
      setModalData((prev) => ({
        ...prev,
        aiSummaryLoading: false,
        aiSummaryError: "Unable to generate AI summary right now.",
      }));
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    activeRef.current = null;
  }, []);

  return { modalOpen, modalData, openModal, closeModal };
}
