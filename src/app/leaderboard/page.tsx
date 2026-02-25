"use client";

import { Download, RefreshCw, Search } from "lucide-react";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLeaderboard } from "@/lib/leaderboard/use-leaderboard";
import { useWatchlist } from "@/lib/leaderboard/use-watchlist";
import { useWalletModal } from "@/lib/leaderboard/use-wallet-modal";
import type { Category, LeaderboardRow, TimePeriod } from "@/lib/leaderboard/types";
import {
  CATEGORIES,
  TIME_PERIODS,
  exportCsv,
  extractWalletAddress,
  formatCurrency,
  normalizeUsername,
  shortAddress,
} from "@/lib/leaderboard/utils";
import { LeaderboardTable } from "./leaderboard-table";
import { WalletDetailDialog } from "./wallet-detail-dialog";

export default function LeaderboardPage() {
  const {
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
  } = useLeaderboard();

  const { tracked, isTracked, toggleTrack } = useWatchlist();
  const { modalOpen, modalData, openModal, closeModal } = useWalletModal();

  function handleExportLeaderboard() {
    const headers = ["Rank", "Name", "Address", "Event", "Positions Value", "PNL", "Volume"];
    const rows = filteredRows.map((row) => [
      row.rank ?? "",
      row.name ?? "",
      row.address ?? "",
      row.event ?? "",
      row.positionsValue ?? "",
      row.pnl ?? "",
      row.volume ?? "",
    ]);
    exportCsv(rows, headers, "polymarket-leaderboard");
  }

  // Build watchlist rows from tracked addresses
  const watchlistRows = tracked.map((address) => {
    const found = leaderboard.find((r) => r.address?.toLowerCase() === address);
    if (found) return found;
    // Placeholder for tracked wallets not in current leaderboard
    return {
      rank: null,
      name: null,
      address,
      pnl: 0,
      volume: 0,
      event: null,
      positionsCount: null,
      positionsValue: null,
      isSmartMoney: false,
      isVerified: false,
      labels: [],
    } satisfies LeaderboardRow;
  });

  return (
    <>
      <Toaster position="bottom-right" />

      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              Top traders from Polymarket&apos;s live Data API
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div>
              <span className="text-xs">Category</span>
              <p className="font-medium text-foreground">{category}</p>
            </div>
            <div>
              <span className="text-xs">Period</span>
              <p className="font-medium text-foreground">{timePeriod}</p>
            </div>
            <div>
              <span className="text-xs">Results</span>
              <p className="font-medium text-foreground">{leaderboard.length}</p>
            </div>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="leaderboard">
          <TabsList>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="watchlist">
              Watchlist {tracked.length > 0 && `(${tracked.length})`}
            </TabsTrigger>
          </TabsList>

          {/* Leaderboard Tab */}
          <TabsContent value="leaderboard" className="space-y-3">
            {/* Controls */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by address or name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="flex gap-2">
                <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as TimePeriod)}>
                  <SelectTrigger className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_PERIODS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={handleExportLeaderboard}>
                  <Download className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void loadLeaderboard()}
                  disabled={isLoading}
                >
                  <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {/* Status */}
            <p className={`text-xs ${isLoading ? "text-muted-foreground animate-pulse" : "text-muted-foreground"}`}>
              {status}
            </p>

            {/* Table */}
            <LeaderboardTable
              rows={sortedRows}
              sortState={sortState}
              onSort={setSortState}
              onOpenWallet={openModal}
              isTracked={isTracked}
              onToggleTrack={(addr) => void toggleTrack(addr)}
            />
          </TabsContent>

          {/* Watchlist Tab */}
          <TabsContent value="watchlist" className="space-y-3">
            {tracked.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No tracked wallets yet. Star a wallet from the leaderboard to add it here.
              </p>
            ) : (
              <LeaderboardTable
                rows={watchlistRows}
                sortState={sortState}
                onSort={setSortState}
                onOpenWallet={openModal}
                isTracked={isTracked}
                onToggleTrack={(addr) => void toggleTrack(addr)}
              />
            )}
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <p className="text-xs text-muted-foreground pt-2">
          Data source: Polymarket Data API. Smart Money classification combines performance rules
          and optional WalletLabels signals.
        </p>
      </div>

      {/* Wallet Detail Dialog */}
      <WalletDetailDialog
        open={modalOpen}
        onClose={closeModal}
        data={modalData}
        isTracked={isTracked(modalData.address)}
        onToggleTrack={() => void toggleTrack(modalData.address)}
      />
    </>
  );
}
