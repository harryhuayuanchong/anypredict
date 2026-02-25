"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { extractWalletAddress, WATCHLIST_CLIENT_KEY } from "./utils";

export function useWatchlist() {
  const [tracked, setTracked] = useState<string[]>([]);
  const clientIdRef = useRef<string>("");

  function getOrCreateClientId() {
    if (clientIdRef.current) return clientIdRef.current;

    const existing = window.localStorage.getItem(WATCHLIST_CLIENT_KEY);
    if (existing) {
      clientIdRef.current = existing;
      return existing;
    }

    const generated = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(WATCHLIST_CLIENT_KEY, generated);
    clientIdRef.current = generated;
    return generated;
  }

  useEffect(() => {
    const load = async () => {
      const clientId = getOrCreateClientId();
      const response = await fetch("/api/leaderboard/watchlist", {
        method: "GET",
        headers: { "x-client-id": clientId },
      }).catch(() => null);

      if (!response || !response.ok) {
        toast.error("Unable to sync watchlist");
        return;
      }

      const data = await response.json();
      const wallets = Array.isArray(data?.wallets) ? data.wallets : [];
      setTracked(wallets);
    };

    void load();
  }, []);

  const isTracked = useCallback(
    (address: string | null) => {
      const normalized = extractWalletAddress(address);
      if (!normalized) return false;
      return tracked.includes(normalized);
    },
    [tracked]
  );

  const toggleTrack = useCallback(
    async (address: string | null) => {
      const normalized = extractWalletAddress(address);
      if (!normalized) {
        toast.error("Wallet address unavailable");
        return;
      }
      const clientId = getOrCreateClientId();

      const exists = tracked.includes(normalized);
      const next = exists ? tracked.filter((a) => a !== normalized) : [...tracked, normalized];
      setTracked(next);

      const response = await fetch("/api/leaderboard/watchlist", {
        method: exists ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-id": clientId,
        },
        body: JSON.stringify({ walletAddress: normalized }),
      }).catch(() => null);

      if (!response || !response.ok) {
        setTracked(tracked);
        toast.error("Unable to update watchlist");
        return;
      }

      toast.success(exists ? "Removed from watchlist" : "Added to watchlist");
    },
    [tracked]
  );

  return { tracked, isTracked, toggleTrack };
}
