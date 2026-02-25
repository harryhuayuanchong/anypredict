"use client";

import { ArrowUpDown, Copy, ExternalLink, Star } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeaderboardRow, SortState } from "@/lib/leaderboard/types";
import {
  extractWalletAddress,
  formatCurrency,
  getSmartMoneyTags,
  normalizeUsername,
  shortAddress,
  type SmartMoneyTag,
} from "@/lib/leaderboard/utils";

const TAG_COLORS: Record<SmartMoneyTag["color"], string> = {
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  purple: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  green: "bg-green-500/15 text-green-400 border-green-500/20",
  orange: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  red: "bg-red-500/15 text-red-400 border-red-500/20",
  yellow: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  cyan: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
};

type Props = {
  rows: LeaderboardRow[];
  sortState: SortState;
  onSort: (state: SortState) => void;
  onOpenWallet: (row: LeaderboardRow) => void;
  isTracked: (address: string | null) => boolean;
  onToggleTrack: (address: string | null) => void;
};

export function LeaderboardTable({
  rows,
  sortState,
  onSort,
  onOpenWallet,
  isTracked,
  onToggleTrack,
}: Props) {
  function toggleSort(key: "pnl" | "volume") {
    onSort({
      key,
      direction: sortState.key === key && sortState.direction === "desc" ? "asc" : "desc",
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">Rank</TableHead>
          <TableHead>Username</TableHead>
          <TableHead className="hidden sm:table-cell">Event (Last Trade)</TableHead>
          <TableHead className="hidden md:table-cell">Positions</TableHead>
          <TableHead>
            <button
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              onClick={() => toggleSort("pnl")}
            >
              PNL
              <ArrowUpDown className="size-3" />
              {sortState.key === "pnl" && (
                <span className="text-xs">{sortState.direction === "asc" ? "↑" : "↓"}</span>
              )}
            </button>
          </TableHead>
          <TableHead className="hidden sm:table-cell">
            <button
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              onClick={() => toggleSort("volume")}
            >
              Volume
              <ArrowUpDown className="size-3" />
              {sortState.key === "volume" && (
                <span className="text-xs">{sortState.direction === "asc" ? "↑" : "↓"}</span>
              )}
            </button>
          </TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const resolvedAddress = extractWalletAddress(row.address || row.name);
          const tracked = isTracked(resolvedAddress);
          const tags = getSmartMoneyTags(row);
          return (
            <TableRow key={row.address ?? row.rank ?? Math.random()}>
              <TableCell className="font-medium">{row.rank ?? "—"}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <button
                    className="inline-flex items-center gap-1 text-left hover:underline"
                    onClick={() => row.address && onOpenWallet(row)}
                  >
                    <span className="font-medium">
                      {normalizeUsername(row.name, row.address)}
                    </span>
                    <ExternalLink className="size-3 text-muted-foreground" />
                  </button>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>{shortAddress(row.address)}</span>
                    {row.address && (
                      <button
                        type="button"
                        className="hover:text-foreground transition-colors"
                        onClick={async () => {
                          await navigator.clipboard.writeText(row.address || "");
                          toast.success("Address copied");
                        }}
                      >
                        <Copy className="size-3" />
                      </button>
                    )}
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={tag.label}
                          className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium leading-4 ${TAG_COLORS[tag.color]}`}
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden sm:table-cell max-w-[200px] truncate text-muted-foreground">
                {row.event || "—"}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {row.positionsCount === null ? (
                  "—"
                ) : (
                  <span className="text-muted-foreground">{formatCurrency(row.positionsValue)}</span>
                )}
              </TableCell>
              <TableCell className={row.pnl >= 0 ? "text-green-500" : "text-red-500"}>
                {formatCurrency(row.pnl)}
              </TableCell>
              <TableCell className="hidden sm:table-cell text-muted-foreground">
                {formatCurrency(row.volume)}
              </TableCell>
              <TableCell>
                <button
                  type="button"
                  className="hover:text-yellow-400 transition-colors"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleTrack(resolvedAddress);
                  }}
                >
                  <Star
                    className={`size-4 ${tracked ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                  />
                </button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
