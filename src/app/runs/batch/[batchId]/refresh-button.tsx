"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RefreshBatchButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<{
    price_changes: number;
    updated_count: number;
  } | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    setResult(null);
    try {
      const res = await fetch("/api/runs/refresh-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");

      setResult({
        price_changes: data.price_changes,
        updated_count: data.updated_count,
      });

      // Refresh the server component data
      router.refresh();
    } catch (err) {
      console.error("Refresh error:", err);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={handleRefresh}
        disabled={refreshing}
        variant="outline"
        size="sm"
      >
        {refreshing ? (
          <span className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            Refreshing...
          </span>
        ) : (
          "↻ Refresh Prices"
        )}
      </Button>
      {result && (
        <span className="text-xs text-muted-foreground">
          {result.price_changes > 0
            ? `${result.price_changes} price${result.price_changes > 1 ? "s" : ""} updated`
            : "Prices unchanged"}
        </span>
      )}
    </div>
  );
}
