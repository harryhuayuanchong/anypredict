"use client";

import { type ReactNode } from "react";
import { Copy, ExternalLink, Download, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WalletModalData } from "@/lib/leaderboard/types";
import { exportCsv, formatCurrency, formatDate } from "@/lib/leaderboard/utils";
import { PnlChart } from "./pnl-chart";

type Props = {
  open: boolean;
  onClose: () => void;
  data: WalletModalData;
  isTracked: boolean;
  onToggleTrack: () => void;
};

// ── AI text highlight helper ────────────────────────────

function highlightByRegex(nodes: ReactNode[], regex: RegExp, className: string) {
  const result: ReactNode[] = [];
  let key = 0;
  for (const node of nodes) {
    if (typeof node !== "string") {
      result.push(node);
      continue;
    }
    let last = 0;
    for (const match of node.matchAll(regex)) {
      const idx = match.index ?? 0;
      if (idx > last) result.push(node.slice(last, idx));
      result.push(
        <span key={`${className}-${key++}`} className={className}>
          {match[0]}
        </span>
      );
      last = idx + match[0].length;
    }
    if (last < node.length) result.push(node.slice(last));
  }
  return result;
}

function renderAiText(text: string, eventName?: string, categoryName?: string) {
  let nodes: ReactNode[] = [text];

  if (eventName) {
    const safe = eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    nodes = highlightByRegex(nodes, new RegExp(safe, "gi"), "text-blue-400");
  }

  if (categoryName) {
    const safe = categoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    nodes = highlightByRegex(nodes, new RegExp(safe, "gi"), "text-purple-400");
  }

  nodes = highlightByRegex(
    nodes,
    /(\$-?\d[\d,]*(?:\.\d+)?|-?\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\b)/g,
    "font-semibold text-foreground"
  );

  return nodes;
}

// ── Main Component ──────────────────────────────────────

export function WalletDetailDialog({ open, onClose, data, isTracked, onToggleTrack }: Props) {
  function handleExportPositions() {
    const headers = ["Title", "Outcome", "Market", "Current Value", "PNL", "Shares"];
    const rows = data.positions.map((p) => [
      p.title,
      p.outcome,
      p.market ?? "",
      p.value,
      p.pnl,
      p.shares ?? "",
    ]);
    exportCsv(rows, headers, "positions");
  }

  function handleExportHistory() {
    const headers = ["Title", "Side", "USDC Size", "Timestamp", "Status", "Market"];
    const rows = data.history.map((h) => [
      h.title,
      h.side,
      h.size,
      h.time,
      h.status ?? "",
      h.market ?? "",
    ]);
    exportCsv(rows, headers, "trading-history");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
              {data.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <DialogTitle>{data.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <span>{data.joined}</span>
                <span>·</span>
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  onClick={async () => {
                    if (!data.address) return;
                    await navigator.clipboard.writeText(data.address);
                    toast.success("Address copied");
                  }}
                >
                  {data.addressShort}
                  <Copy className="size-3" />
                </button>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Lifetime PNL</p>
              <p className={`text-sm font-bold ${data.lifetimePnlNeg ? "text-red-500" : ""}`}>
                {data.lifetimePnl}
              </p>
              <p className="text-xs text-muted-foreground">Closed positions</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Lifetime Volume</p>
              <p className="text-sm font-bold">{data.lifetimeVol}</p>
              <p className="text-xs text-muted-foreground">Recent activity</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Open Positions</p>
              <p className="text-sm font-bold">{data.positionsCount}</p>
              <p className="text-xs text-muted-foreground">Value: {data.positionsValue}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Trades (Recent)</p>
              <p className="text-sm font-bold">{data.tradesCount}</p>
              <p className="text-xs text-muted-foreground">Last 200</p>
            </CardContent>
          </Card>
        </div>

        {/* AI Summary */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">AI Summary</CardTitle>
              {data.aiSummarySource && (
                <span className="text-xs text-muted-foreground">
                  {data.aiSummarySource === "model" ? "AI model" : "Rule-based"}
                  {data.aiSummaryUpdatedAt && ` · ${formatDate(data.aiSummaryUpdatedAt)}`}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {data.aiSummaryLoading ? (
              <p className="text-sm text-muted-foreground">Generating summary...</p>
            ) : data.aiSummaryError ? (
              <p className="text-sm text-muted-foreground">{data.aiSummaryError}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    ["Performance Snapshot", data.aiSummary.performanceSnapshot],
                    ["Holding Behavior", data.aiSummary.holdingBehavior],
                    ["Trade Pattern", data.aiSummary.tradePattern],
                    ["Category Edge", data.aiSummary.categoryEdge],
                  ] as const
                ).map(([title, text]) => (
                  <div key={title} className="rounded-md bg-muted/50 p-3">
                    <h4 className="text-xs font-semibold mb-1">{title}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {renderAiText(text, data.aiSummaryEvent, data.aiSummaryCategory)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* PNL Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                PNL <span className="text-xs text-muted-foreground font-normal">All time</span>
              </CardTitle>
              <span className="text-sm font-bold">{data.chartValue}</span>
            </div>
          </CardHeader>
          <CardContent className="pb-2">
            <PnlChart data={data.chartPoints} />
          </CardContent>
        </Card>

        {/* Trade & Position Summaries */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Trade Summary</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              {data.tradeSummary ? (
                <>
                  <div className="flex justify-between"><span>Trades</span><span className="font-medium">{data.tradeSummary.totalTrades}</span></div>
                  <div className="flex justify-between"><span>Buys</span><span className="font-medium">{data.tradeSummary.buys}</span></div>
                  <div className="flex justify-between"><span>Sells</span><span className="font-medium">{data.tradeSummary.sells}</span></div>
                  <div className="flex justify-between"><span>Volume</span><span className="font-medium">{formatCurrency(data.tradeSummary.volume)}</span></div>
                </>
              ) : (
                <p className="text-muted-foreground">No recent trades.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Position Summary</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              {data.positionSummary ? (
                <>
                  <div className="flex justify-between"><span>Open Positions</span><span className="font-medium">{data.positionSummary.openPositions}</span></div>
                  <div className="flex justify-between"><span>Total Value</span><span className="font-medium">{formatCurrency(data.positionSummary.totalValue)}</span></div>
                  <div className="flex justify-between"><span>Largest</span><span className="font-medium truncate max-w-[120px]">{data.positionSummary.largestTitle}</span></div>
                  <div className="flex justify-between"><span>Largest Value</span><span className="font-medium">{formatCurrency(data.positionSummary.largestValue)}</span></div>
                </>
              ) : (
                <p className="text-muted-foreground">No open positions.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Position Details */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Position Details</CardTitle>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleExportPositions}>
                <Download className="size-3 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.positions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No open positions.</p>
            ) : (
              data.positions.map((p, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-2 text-xs">
                  <p className="font-medium">{p.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                    <span>Outcome: {p.outcome}</span>
                    <Badge variant={p.pnl >= 0 ? "default" : "destructive"} className="text-[10px] px-1 py-0">
                      PNL {formatCurrency(p.pnl)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-0.5">Value: {formatCurrency(p.value)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Trading History */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Trading History</CardTitle>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleExportHistory}>
                <Download className="size-3 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recent trades.</p>
            ) : (
              data.history.map((h, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-2 text-xs">
                  <p className="font-medium">{h.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                    <Badge
                      variant={h.side.toUpperCase() === "BUY" ? "default" : "secondary"}
                      className="text-[10px] px-1 py-0"
                    >
                      {h.side}
                    </Badge>
                    <span>{formatCurrency(h.size)}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">{h.time}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" size="sm" asChild>
            <a
              href={data.address ? `https://polymarket.com/profile/${data.address}` : "#"}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-3 mr-1" />
              View Profile
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={onToggleTrack}>
            <Star className={`size-3 mr-1 ${isTracked ? "fill-yellow-400 text-yellow-400" : ""}`} />
            {isTracked ? "Untrack" : "Track"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
