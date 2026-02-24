"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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

      {/* ═══ Status Card ═══ */}
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
              {status?.dry_run ? (
                <Badge variant="secondary">Dry Run</Badge>
              ) : (
                <Badge variant="default" className="bg-orange-600">
                  LIVE
                </Badge>
              )}
            </div>
            {status?.wallet_address && (
              <p className="mt-2 text-xs text-muted-foreground font-mono truncate">
                {status.wallet_address}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              USDC Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {status?.balance_usdc != null
                ? `$${status.balance_usdc.toFixed(2)}`
                : "—"}
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
    </div>
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
