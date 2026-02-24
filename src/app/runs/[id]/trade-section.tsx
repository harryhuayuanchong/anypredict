"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TradeOrder } from "@/lib/trading/types";

interface TradeSectionProps {
  runId: string;
  recommendation: string | null;
}

export function TradeSection({ runId, recommendation }: TradeSectionProps) {
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/trading/orders?run_id=${runId}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch {
      // silent
    }
  }, [runId]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

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
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execute failed");
    } finally {
      setExecuting(false);
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
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const isTradeableRec =
    recommendation === "BUY_YES" || recommendation === "BUY_NO";
  const hasActiveOrder = orders.some((o) =>
    ["pending", "submitted", "live", "matched"].includes(o.status)
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          Trade Execution
          {orders.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {orders.length} order{orders.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Execute button */}
        {isTradeableRec && !hasActiveOrder && (
          <Button
            onClick={handleExecute}
            disabled={executing}
            className="w-full"
          >
            {executing
              ? "Executing..."
              : `Execute Trade (${recommendation})`}
          </Button>
        )}

        {!isTradeableRec && orders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No trade signal — execution not available.
          </p>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive flex justify-between">
            <span>{error}</span>
            <button className="underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}

        {/* Order history */}
        {orders.length > 0 && (
          <div className="space-y-2">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between text-xs border rounded-md p-2"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      order.outcome === "YES" ? "default" : "secondary"
                    }
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
                  <StatusBadge status={order.status} />
                  {order.dry_run && (
                    <Badge variant="outline" className="text-xs">
                      Dry
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {new Date(order.created_at).toLocaleTimeString()}
                  </span>
                  {["pending", "submitted", "live", "matched"].includes(
                    order.status
                  ) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel(order.id)}
                      className="text-xs h-6"
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    live: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    matched: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    filled: "bg-green-200 text-green-900 dark:bg-green-900/50 dark:text-green-300",
    cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || colors.pending}`}>
      {status}
    </span>
  );
}
