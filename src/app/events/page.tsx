"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { PolymarketEvent } from "@/app/api/events/route";

type ViewMode = "grid" | "list";
type CategoryFilter = "all" | "Temperature" | "Snow" | "Earthquake" | "Climate" | "Weather" | "Storm" | "Rain";
type StatusFilter = "active" | "resolved" | "all";

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatLiquidity(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function categoryColor(cat: string | null): string {
  switch (cat) {
    case "Temperature":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
    case "Snow":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    case "Earthquake":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    case "Climate":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "Storm":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
    case "Rain":
      return "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

const REFRESH_INTERVAL_MS = 60_000; // Auto-refresh every 60s

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function EventsPage() {
  const [events, setEvents] = useState<PolymarketEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeAgoStr, setTimeAgoStr] = useState("");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchEvents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setEvents(data.events || []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch + auto-refresh interval
  useEffect(() => {
    fetchEvents(false);

    intervalRef.current = setInterval(() => {
      fetchEvents(true);
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEvents]);

  // Update "time ago" display every 10s
  useEffect(() => {
    const tick = setInterval(() => {
      if (lastUpdated) setTimeAgoStr(timeAgo(lastUpdated));
    }, 10_000);
    if (lastUpdated) setTimeAgoStr(timeAgo(lastUpdated));
    return () => clearInterval(tick);
  }, [lastUpdated]);

  // Filter events
  const filtered = events.filter((e) => {
    // Status filter
    if (status === "active" && e.closed) return false;
    if (status === "resolved" && !e.closed) return false;
    // Category filter
    if (category !== "all" && e.category !== category) return false;
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        e.slug.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = events.filter((e) => !e.closed).length;
  const resolvedCount = events.filter((e) => e.closed).length;

  // Extract unique categories for filter
  const categories = Array.from(new Set(events.map((e) => e.category).filter(Boolean))) as string[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-sm text-muted-foreground">
              Live prediction markets on Polymarket
            </p>
            {lastUpdated && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="text-muted-foreground">•</span>
                {refreshing ? (
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
                    Refreshing...
                  </span>
                ) : (
                  <button
                    onClick={() => fetchEvents(true)}
                    className="hover:text-foreground transition-colors"
                    title="Click to refresh now"
                  >
                    Updated {timeAgoStr}
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
        <Link href="/new">
          <Button>+ New Analysis</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Row 1: Search + View toggle */}
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-9"
          />
          <div className="flex gap-1 ml-auto shrink-0">
            <button
              onClick={() => setView("grid")}
              className={`p-1.5 rounded transition-colors ${
                view === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="Grid view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
            <button
              onClick={() => setView("list")}
              className={`p-1.5 rounded transition-colors ${
                view === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="List view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: Status + Category filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status filter */}
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 gap-0.5">
            {([
              { key: "active", label: "Active", count: activeCount },
              { key: "resolved", label: "Resolved", count: resolvedCount },
              { key: "all", label: "All", count: events.length },
            ] as const).map((s) => (
              <button
                key={s.key}
                onClick={() => setStatus(s.key)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                  status === s.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
                <span className={`ml-1 ${status === s.key ? "text-foreground" : "text-muted-foreground/60"}`}>
                  {s.count}
                </span>
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-border hidden sm:block" />

          {/* Category filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setCategory("all")}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                category === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat as CategoryFilter)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                  category === cat
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {cat}
                <span className={`ml-1 tabular-nums ${category === cat ? "text-primary-foreground/70" : "text-muted-foreground/50"}`}>
                  {events.filter((e) => e.category === cat).length}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result count */}
      {!loading && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          {status !== "all" && ` (${status})`}
          {category !== "all" && ` in ${category}`}
          {search && ` matching "${search}"`}
        </p>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            Loading events from Polymarket...
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {search || category !== "all" || status !== "active"
            ? "No events match your filters."
            : "No active events found on Polymarket."}
        </div>
      )}

      {/* Grid View */}
      {!loading && view === "grid" && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* List View */}
      {!loading && view === "list" && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event }: { event: PolymarketEvent }) {
  return (
    <Card className={`hover:shadow-md transition-shadow flex flex-col ${event.closed ? "opacity-75" : ""}`}>
      <CardContent className="pt-4 flex-1 flex flex-col">
        {/* Category + status */}
        <div className="flex items-center gap-2 mb-2">
          <Badge
            className={`text-[10px] border-0 ${categoryColor(event.category)}`}
          >
            {event.category}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {event.market_count} market{event.market_count !== 1 ? "s" : ""}
          </span>
          {event.closed ? (
            <Badge variant="outline" className="text-[10px] ml-auto border-muted-foreground/30 text-muted-foreground">
              Resolved
            </Badge>
          ) : (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-medium text-sm leading-snug mb-3 flex-1">
          {event.title}
        </h3>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
          <div>
            <span className="font-semibold text-foreground tabular-nums">
              {formatVolume(event.volume)}
            </span>{" "}
            vol
          </div>
          <div>
            <span className="font-semibold text-foreground tabular-nums">
              {formatLiquidity(event.liquidity)}
            </span>{" "}
            liq
          </div>
          {event.end_date && (
            <div className="ml-auto">
              {event.closed ? "Ended" : "Ends"}{" "}
              {new Date(event.end_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </div>
          )}
        </div>

        {/* Action */}
        <Link
          href={`/new?url=${encodeURIComponent(event.url)}`}
          className="w-full"
        >
          <Button size="sm" variant={event.closed ? "outline" : "default"} className="w-full">
            Analyze
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: PolymarketEvent }) {
  return (
    <div className={`flex items-center gap-4 rounded-lg border p-3 hover:bg-muted/50 transition-colors ${event.closed ? "opacity-75" : ""}`}>
      {/* Status dot */}
      <span className={`shrink-0 h-2 w-2 rounded-full ${event.closed ? "bg-muted-foreground/40" : "bg-emerald-500"}`} />

      {/* Category */}
      <Badge
        className={`text-[10px] border-0 shrink-0 ${categoryColor(event.category)}`}
      >
        {event.category}
      </Badge>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{event.title}</p>
        <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
          <span>{event.market_count} market{event.market_count !== 1 ? "s" : ""}</span>
          <span className="tabular-nums">{formatVolume(event.volume)} vol</span>
          <span className="tabular-nums">{formatLiquidity(event.liquidity)} liq</span>
          {event.end_date && (
            <span>
              {event.closed ? "Ended" : "Ends"}{" "}
              {new Date(event.end_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <Link href={`/new?url=${encodeURIComponent(event.url)}`}>
        <Button size="sm" variant="outline">
          Analyze
        </Button>
      </Link>
    </div>
  );
}
