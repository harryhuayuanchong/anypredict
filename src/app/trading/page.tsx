"use client";

import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TradeOrder } from "@/lib/trading/types";

interface TradingStatus {
  configured: boolean;
  dry_run: boolean;
  auto_trade: boolean;
  max_position_usd: number;
  max_total_exposure_usd: number;
  auto_min_edge: number;
  auto_min_conviction: number;
  open_orders: number;
  total_exposure: number;
  recent_fills: number;
  recent_fills_usd: number;
  balance_usdc: number | null;
  wallet_address: string | null;
  balance_error?: string;
}

export default function TradingPage() {
  const [status, setStatus] = useState<TradingStatus | null>(null);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, ordersRes] = await Promise.all([
        fetch("/api/trading/status"),
        fetch("/api/trading/orders?limit=30"),
      ]);
      const statusData = await statusRes.json();
      const ordersData = await ordersRes.json();

      if (statusRes.ok) setStatus(statusData);
      if (ordersRes.ok) setOrders(ordersData.orders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSetup = async () => {
    setSetupLoading(true);
    try {
      const res = await fetch("/api/trading/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      const res = await fetch("/api/trading/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const handleCancelAll = async () => {
    setCancellingAll(true);
    try {
      // Cancel all open orders by updating each
      const openOrders = orders.filter((o) =>
        ["pending", "submitted", "live", "matched"].includes(o.status)
      );
      for (const order of openOrders) {
        await fetch("/api/trading/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: order.id }),
        });
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel all failed");
    } finally {
      setCancellingAll(false);
    }
  };

  // Toggle dry-run mode
  const handleModeToggle = (checked: boolean) => {
    const goingLive = checked; // checked=ON means LIVE mode
    if (goingLive) {
      // Switching to LIVE → show confirmation dialog
      setShowLiveConfirm(true);
    } else {
      // Switching back to Dry Run → no confirmation needed
      applyModeChange(true);
    }
  };

  const applyModeChange = async (dryRun: boolean) => {
    setToggling(true);
    // Optimistic UI
    const prevDryRun = status?.dry_run;
    if (status) setStatus({ ...status, dry_run: dryRun });

    try {
      const res = await fetch("/api/trading/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun, confirm: !dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Sync with server state
      if (status) setStatus({ ...status, dry_run: data.dry_run });
    } catch (err) {
      // Rollback on error
      if (status && prevDryRun !== undefined)
        setStatus({ ...status, dry_run: prevDryRun });
      setError(err instanceof Error ? err.message : "Mode switch failed");
    } finally {
      setToggling(false);
    }
  };

  const confirmGoLive = () => {
    setShowLiveConfirm(false);
    applyModeChange(false);
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Loading trading dashboard...
      </div>
    );
  }

  const openOrders = orders.filter((o) =>
    ["pending", "submitted", "live", "matched"].includes(o.status)
  );
  const recentFills = orders.filter((o) => o.status === "filled");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trading</h1>
        <div className="flex gap-2">
          {openOrders.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelAll}
              disabled={cancellingAll}
            >
              {cancellingAll ? "Cancelling..." : `Cancel All (${openOrders.length})`}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
          <button
            className="ml-2 underline"
            onClick={() => setError(null)}
          >
            dismiss
          </button>
        </div>
      )}

      {/* ═══ Status + Wallet ═══ */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {status?.configured ? (
                <Badge variant="default" className="bg-green-600">
                  Connected
                </Badge>
              ) : (
                <Badge variant="destructive">Not Configured</Badge>
              )}
            </div>
            {/* ── Dry Run / LIVE toggle ── */}
            <div className="mt-3 flex items-center gap-3">
              <span
                className={`text-sm font-medium ${
                  status?.dry_run ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                Dry Run
              </span>
              <Switch
                checked={!status?.dry_run}
                onCheckedChange={handleModeToggle}
                disabled={toggling || !status?.configured}
                className="data-[state=checked]:bg-orange-600"
              />
              <span
                className={`text-sm font-medium ${
                  !status?.dry_run ? "text-orange-600" : "text-muted-foreground"
                }`}
              >
                LIVE
              </span>
              {toggling && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  Switching...
                </span>
              )}
            </div>
            {!status?.dry_run && (
              <p className="mt-1.5 text-[10px] text-orange-600 font-medium">
                Real money orders will be placed on Polymarket
              </p>
            )}
            {status?.wallet_address && (
              <WalletAddress address={status.wallet_address} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              USDC.e Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {status?.balance_usdc != null
                ? `$${status.balance_usdc.toFixed(2)}`
                : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Polygon &middot; USDC.e (Bridged)
            </p>
            {status?.balance_error && (
              <p className="text-xs text-destructive mt-1">
                {status.balance_error}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Open Exposure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              ${(status?.total_exposure || 0).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              {status?.open_orders || 0} open orders / max $
              {status?.max_total_exposure_usd || 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recent Fills
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {status?.recent_fills || 0}
            </p>
            <p className="text-xs text-muted-foreground">
              ${(status?.recent_fills_usd || 0).toFixed(2)} total volume
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ═══ Fund Wallet ═══ */}
      {status?.wallet_address && (
        <FundWalletCard address={status.wallet_address} balance={status.balance_usdc} />
      )}

      {/* ═══ Config Summary ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Configuration
            {status?.auto_trade ? (
              <Badge className="bg-green-600 text-xs">Auto-Trade ON</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                Auto-Trade OFF
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <p className="text-muted-foreground">Max Position</p>
              <p className="font-medium">
                ${status?.max_position_usd || 0}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Max Total Exposure</p>
              <p className="font-medium">
                ${status?.max_total_exposure_usd || 0}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Min Edge</p>
              <p className="font-medium">
                {((status?.auto_min_edge || 0) * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Min Conviction</p>
              <p className="font-medium">
                {status?.auto_min_conviction || 0}
              </p>
            </div>
          </div>

          {!status?.configured && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Trading not configured. Add POLYMARKET_PRIVATE_KEY to .env,
                  then run setup.
                </p>
                <Button
                  onClick={handleSetup}
                  disabled={setupLoading}
                  size="sm"
                >
                  {setupLoading ? "Setting up..." : "Run Setup"}
                </Button>
              </div>
            </>
          )}

          {status?.configured && (
            <>
              <Separator className="my-4" />
              <Button
                onClick={handleSetup}
                disabled={setupLoading}
                size="sm"
                variant="outline"
              >
                {setupLoading ? "Checking..." : "Verify Connection"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ═══ Open Orders ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Open Orders ({openOrders.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open orders</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-4">Time</th>
                    <th className="text-left py-2 pr-4">Outcome</th>
                    <th className="text-right py-2 pr-4">Price</th>
                    <th className="text-right py-2 pr-4">Size</th>
                    <th className="text-center py-2 pr-4">Status</th>
                    <th className="text-center py-2 pr-4">Mode</th>
                    <th className="text-right py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((order) => (
                    <tr key={order.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {new Date(order.created_at).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant={
                            order.outcome === "YES" ? "default" : "secondary"
                          }
                          className="text-xs"
                        >
                          {order.outcome}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {(order.price * 100).toFixed(0)}¢
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        ${order.size_usd.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 text-center">
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="py-2 pr-4 text-center">
                        {order.dry_run ? (
                          <Badge variant="outline" className="text-xs">
                            Dry
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs border-orange-500 text-orange-600"
                          >
                            Live
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelOrder(order.id)}
                          className="text-xs h-7"
                        >
                          Cancel
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Recent Fills ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recent Fills ({recentFills.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentFills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fills yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-4">Time</th>
                    <th className="text-left py-2 pr-4">Outcome</th>
                    <th className="text-right py-2 pr-4">Price</th>
                    <th className="text-right py-2 pr-4">Size</th>
                    <th className="text-right py-2 pr-4">Edge</th>
                    <th className="text-center py-2">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFills.map((order) => (
                    <tr key={order.id} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {order.filled_at
                          ? new Date(order.filled_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant={
                            order.outcome === "YES" ? "default" : "secondary"
                          }
                          className="text-xs"
                        >
                          {order.outcome}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {((order.fill_price || order.price) * 100).toFixed(0)}¢
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        ${(order.fill_size_usd || order.size_usd).toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {order.edge_at_placement != null
                          ? `${(order.edge_at_placement * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="py-2 text-center">
                        {order.dry_run ? (
                          <Badge variant="outline" className="text-xs">
                            Dry
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs border-orange-500 text-orange-600"
                          >
                            Live
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Live Mode Confirmation Dialog ═══ */}
      <AlertDialog open={showLiveConfirm} onOpenChange={setShowLiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to LIVE trading?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  You are about to enable <strong>LIVE</strong> trading mode.
                  Real money orders will be submitted to Polymarket.
                </p>
                <div className="rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 p-3 text-sm">
                  <p className="font-medium text-orange-800 dark:text-orange-300">
                    Current safeguards:
                  </p>
                  <ul className="mt-1 list-disc list-inside text-orange-700 dark:text-orange-400 text-xs space-y-0.5">
                    <li>Max position: ${status?.max_position_usd || 50} per order</li>
                    <li>Max total exposure: ${status?.max_total_exposure_usd || 500}</li>
                    <li>
                      Balance: {status?.balance_usdc != null
                        ? `$${status.balance_usdc.toFixed(2)}`
                        : "unknown"}
                    </li>
                  </ul>
                </div>
                <p className="text-xs text-muted-foreground">
                  This change is temporary and will revert to Dry Run on server
                  restart.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmGoLive}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Enable LIVE Trading
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Wallet Address (abbreviated + copy) ──

function WalletAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const abbreviated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="text-xs font-mono text-muted-foreground">{abbreviated}</span>
      <button
        onClick={handleCopy}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Copy full address"
      >
        {copied ? (
          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Fund Wallet Card (QR + chain info) ──

function FundWalletCard({ address, balance }: { address: string; balance: number | null }) {
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);

  const abbreviated = `${address.slice(0, 6)}...${address.slice(-4)}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          Fund Wallet
          {balance != null && balance < 1 && (
            <Badge variant="destructive" className="text-xs">Needs Funding</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Left: Instructions */}
          <div className="flex-1 space-y-3">
            <div className="rounded-md bg-muted/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-white">P</span>
                </div>
                <div>
                  <p className="text-sm font-medium">Polygon (PoS) Chain</p>
                  <p className="text-[10px] text-muted-foreground">Chain ID: 137</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-white">$</span>
                </div>
                <div>
                  <p className="text-sm font-medium">USDC.e (Bridged USDC)</p>
                  <p className="text-[10px] text-muted-foreground font-mono">0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-white">G</span>
                </div>
                <div>
                  <p className="text-sm font-medium">MATIC / POL (for gas)</p>
                  <p className="text-[10px] text-muted-foreground">~0.1 POL is enough for many txs</p>
                </div>
              </div>
            </div>

            {/* Address with copy */}
            <div className="flex items-center gap-2 rounded-md border p-2.5">
              <span className="text-xs font-mono flex-1 truncate">{address}</span>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>

            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Send <strong className="text-foreground">USDC.e</strong> and a small amount of <strong className="text-foreground">POL</strong> (for gas)
              to the address above on the <strong className="text-foreground">Polygon</strong> network.
              Do NOT send tokens on other chains (Ethereum, Arbitrum, etc.) — they will be lost.
            </p>
          </div>

          {/* Right: QR Code */}
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => setShowQR((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline sm:hidden"
            >
              {showQR ? "Hide QR" : "Show QR Code"}
            </button>
            <div className={`${showQR ? "block" : "hidden"} sm:block`}>
              <div className="p-3 bg-white rounded-lg border">
                <QRCodeSVG
                  value={address}
                  size={140}
                  level="M"
                  includeMargin={false}
                />
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-1.5 font-mono">
                {abbreviated}
              </p>
              <p className="text-[10px] text-center text-muted-foreground">
                Polygon only
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    live: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    matched: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    filled: "bg-green-200 text-green-900 dark:bg-green-900/50 dark:text-green-300",
    cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    expired: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        variants[status] || variants.pending
      }`}
    >
      {status}
    </span>
  );
}
