"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TradeOrder } from "@/lib/trading/types";

interface TradingStatus {
  configured: boolean;
  dry_run: boolean;
  auto_trade: boolean;
  balance_usdc: number | null;
  open_orders: number;
}

interface TradeControlsProps {
  batchId: string;
  runIds: string[];
}

export function TradeControls({ batchId, runIds }: TradeControlsProps) {
  const [status, setStatus] = useState<TradingStatus | null>(null);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);
  const [autoExecuting, setAutoExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, ordersRes] = await Promise.all([
        fetch("/api/trading/status"),
        fetch(`/api/trading/orders?batch_id=${batchId}`),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setOrders(data.orders || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleExecute = async (runId: string) => {
    setExecuting(runId);
    setError(null);
    try {
      const res = await fetch("/api/trading/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execute failed");
    } finally {
      setExecuting(null);
    }
  };

  const handleAutoExecute = async () => {
    setAutoExecuting(true);
    setError(null);
    try {
      const res = await fetch("/api/trading/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-execute failed");
    } finally {
      setAutoExecuting(false);
    }
  };

  const handleCancel = async (orderId: string) => {
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

  if (loading) return null;

  // Map run_id → order for inline display
  const orderByRunId = new Map<string, TradeOrder>();
  for (const order of orders) {
    if (!orderByRunId.has(order.run_id)) {
      orderByRunId.set(order.run_id, order);
    }
  }

  const openOrders = orders.filter((o) =>
    ["pending", "submitted", "live", "matched"].includes(o.status)
  );

  return (
    <div className="space-y-4">
      {/* Trading status banner */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {status?.configured ? (
                <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                  Trading Ready
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs border-red-500 text-red-600">
                  Not Configured
                </Badge>
              )}
              {status?.dry_run && (
                <Badge variant="secondary" className="text-xs">Dry Run</Badge>
              )}
              {status?.balance_usdc != null && (
                <span className="text-xs text-muted-foreground">
                  Balance: ${status.balance_usdc.toFixed(2)}
                </span>
              )}
              {orders.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {orders.length} order{orders.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={handleAutoExecute}
              disabled={autoExecuting || !status?.configured}
              className="text-xs"
            >
              {autoExecuting ? "Executing..." : "Auto-Execute All"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive flex justify-between">
          <span>{error}</span>
          <button className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {/* Active orders for this batch */}
      {openOrders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Active Orders ({openOrders.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {openOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between text-xs border rounded-md p-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={order.outcome === "YES" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {order.outcome}
                    </Badge>
                    <span className="font-mono">
                      {(order.price * 100).toFixed(0)}¢
                    </span>
                    <span className="text-muted-foreground">
                      ${order.size_usd.toFixed(2)}
                    </span>
                    <OrderStatusBadge status={order.status} />
                    {order.dry_run && (
                      <Badge variant="outline" className="text-xs">Dry</Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancel(order.id)}
                    className="text-xs h-6"
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export execute buttons for individual runs (used inline in table) */}
      <RunTradeButtons
        runIds={runIds}
        orderByRunId={orderByRunId}
        executing={executing}
        onExecute={handleExecute}
      />
    </div>
  );
}

/** Individual execute button for a run (shown in parent via portal pattern) */
function RunTradeButtons({
  runIds,
  orderByRunId,
  executing,
  onExecute,
}: {
  runIds: string[];
  orderByRunId: Map<string, TradeOrder>;
  executing: string | null;
  onExecute: (runId: string) => void;
}) {
  // Render hidden buttons that will be referenced by the table via data attribute
  return (
    <div className="hidden">
      {runIds.map((runId) => {
        const order = orderByRunId.get(runId);
        return (
          <div key={runId} data-trade-button={runId}>
            {order ? (
              <Badge
                variant={order.status === "filled" ? "default" : "secondary"}
                className="text-xs"
              >
                {order.status === "filled"
                  ? `Filled ${order.outcome}`
                  : order.status}
              </Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onExecute(runId)}
                disabled={executing === runId}
                className="text-xs h-7"
              >
                {executing === runId ? "..." : "Trade"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Standalone execute button for inline table use */
export function TradeButton({
  runId,
  batchId,
}: {
  runId: string;
  batchId: string;
}) {
  const [order, setOrder] = useState<TradeOrder | null>(null);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/trading/orders?run_id=${runId}&limit=1`)
      .then((r) => r.json())
      .then((data) => {
        if (data.orders?.[0]) setOrder(data.orders[0]);
      })
      .catch(() => {});
  }, [runId]);

  const handleExecute = async () => {
    setExecuting(true);
    setError(null);
    try {
      const res = await fetch("/api/trading/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.order) setOrder(data.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setExecuting(false);
    }
  };

  if (order) {
    return (
      <OrderStatusBadge status={order.status} />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={handleExecute}
        disabled={executing}
        className="text-xs h-7"
        data-batch-id={batchId}
      >
        {executing ? "..." : "Trade"}
      </Button>
      {error && (
        <span className="text-xs text-destructive" title={error}>
          !
        </span>
      )}
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
