"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CacheEntry, Category, LeaderboardRow, SortState, TimePeriod } from "./types";
import {
  API_BASE,
  DETAILS_LIMIT,
  DETAILS_TTL_MS,
  LABELS_API_BASE,
  SMART_MONEY_ALLOWLIST,
  classifySmartMoney,
  fetchWithTimeout,
} from "./utils";

export function useLeaderboard() {
  const [category, setCategory] = useState<Category>("OVERALL");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("DAY");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [isLoading, setIsLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [sortState, setSortState] = useState<SortState>({ key: "pnl", direction: "desc" });

  const labelCache = useRef<Map<string, CacheEntry<LeaderboardRow["labels"]>>>(new Map());
  const eventCache = useRef<Map<string, CacheEntry<string | null>>>(new Map());
  const positionsCache = useRef<Map<string, CacheEntry<Record<string, unknown>[]>>>(new Map());
  const loadSequence = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Filtered + sorted rows ──────────────────────────

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return leaderboard;
    return leaderboard.filter((row) => {
      const name = row.name ? row.name.toLowerCase() : "";
      const address = row.address ? row.address.toLowerCase() : "";
      return name.includes(query) || address.includes(query);
    });
  }, [leaderboard, search]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    const factor = sortState.direction === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const valueA = a[sortState.key] ?? 0;
      const valueB = b[sortState.key] ?? 0;
      return (valueA - valueB) * factor;
    });
    return rows;
  }, [filteredRows, sortState]);

  // ── Data fetchers ───────────────────────────────────

  async function fetchLeaderboardData() {
    const url = new URL(`${API_BASE}/v1/leaderboard`);
    url.searchParams.set("category", category);
    url.searchParams.set("timePeriod", timePeriod);
    url.searchParams.set("limit", "50");

    const response = await fetchWithTimeout(url.toString());
    if (!response.ok) throw new Error(`Leaderboard request failed: ${response.status}`);
    return response.json();
  }

  async function fetchLabels(address: string, apiKey: string) {
    if (!address || !apiKey) return [];
    const normalized = address.toLowerCase();
    const cached = labelCache.current.get(normalized);
    if (cached && Date.now() - cached.timestamp < DETAILS_TTL_MS) return cached.value;

    const url = new URL(`${LABELS_API_BASE}/ethereum/label/${normalized}`);
    url.searchParams.set("apikey", apiKey);

    const response = await fetchWithTimeout(url.toString()).catch(() => null);
    if (!response || !response.ok) {
      labelCache.current.set(normalized, { value: [], timestamp: Date.now() });
      return [];
    }

    const payload = await response.json();
    const labels = Array.isArray(payload?.data) ? payload.data : [];
    labelCache.current.set(normalized, { value: labels, timestamp: Date.now() });
    return labels;
  }

  async function fetchLastEvent(address: string) {
    if (!address) return null;
    const normalized = address.toLowerCase();
    const cached = eventCache.current.get(normalized);
    if (cached && Date.now() - cached.timestamp < DETAILS_TTL_MS) return cached.value;

    const url = new URL(`${API_BASE}/activity`);
    url.searchParams.set("user", address);
    url.searchParams.set("limit", "1");
    url.searchParams.set("sortBy", "TIMESTAMP");
    url.searchParams.set("sortDirection", "DESC");

    const response = await fetchWithTimeout(url.toString()).catch(() => null);
    if (!response || !response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const activity = data[0];
    const title = activity?.title || activity?.name || activity?.eventTitle || activity?.eventSlug || null;
    eventCache.current.set(normalized, { value: title, timestamp: Date.now() });
    return title;
  }

  async function fetchPositionsForRow(address: string) {
    if (!address) return [];
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

  // ── Main load function ──────────────────────────────

  const loadLeaderboard = useCallback(async () => {
    const currentLoad = ++loadSequence.current;
    setStatus("Loading leaderboard...");
    setIsLoading(true);

    try {
      const data = await fetchLeaderboardData();
      if (currentLoad !== loadSequence.current) return;

      const mapped: LeaderboardRow[] = data.map((entry: Record<string, unknown>, index: number) => {
        const address = (entry.proxyWallet || entry.address || entry.userAddress || entry.user) as string | null;
        const normalized = address ? address.toLowerCase() : null;
        return {
          rank: (entry.rank as number) ?? index + 1,
          name: (entry.userName || entry.name) as string | null,
          address,
          pnl: Number(entry.pnl) || 0,
          volume: Number(entry.vol) || 0,
          event: null,
          positionsCount: null,
          positionsValue: null,
          isSmartMoney: normalized ? SMART_MONEY_ALLOWLIST.has(normalized) : false,
          isVerified: entry.verifiedBadge === true,
          labels: [],
        };
      });

      const apiKey = localStorage.getItem("walletLabelsApiKey") || "";
      if (apiKey) {
        setStatus("Fetching wallet labels...");
        await Promise.all(
          mapped.map(async (row) => {
            if (!row.address) return;
            row.labels = await fetchLabels(row.address, apiKey);
            if (!row.isSmartMoney) {
              row.isSmartMoney = classifySmartMoney(row, row.labels);
            }
          })
        );
      }

      const detailRows = mapped.slice(0, DETAILS_LIMIT);
      setStatus(`Fetching last event for top ${DETAILS_LIMIT}...`);
      await Promise.all(
        detailRows.map(async (row) => {
          if (row.address) {
            row.event = await fetchLastEvent(row.address);
          }
        })
      );

      if (currentLoad !== loadSequence.current) return;

      setStatus(`Fetching positions for top ${DETAILS_LIMIT}...`);
      await Promise.all(
        detailRows.map(async (row) => {
          if (row.address) {
            const positions = await fetchPositionsForRow(row.address);
            row.positionsCount = positions.length;
            row.positionsValue = positions.reduce((sum: number, p) => {
              const value = Number((p as Record<string, unknown>)?.currentValue ?? (p as Record<string, unknown>)?.value ?? 0);
              return sum + (Number.isNaN(value) ? 0 : value);
            }, 0);
          }
        })
      );

      if (currentLoad !== loadSequence.current) return;

      setLeaderboard(mapped);
      setStatus(`Loaded ${mapped.length} rows.`);
      setIsLoading(false);
    } catch (error) {
      console.error(error);
      setStatus("Unable to load leaderboard. Check console for details.");
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, timePeriod]);

  // ── Auto-load on filter change ──────────────────────

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void loadLeaderboard();
    }, 200);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [loadLeaderboard]);

  return {
    category,
    setCategory,
    timePeriod,
    setTimePeriod,
    search,
    setSearch,
    status,
    isLoading,
    leaderboard,
    sortState,
    setSortState,
    filteredRows,
    sortedRows,
    loadLeaderboard,
  };
}
