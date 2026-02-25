import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

type WatchlistRow = {
  client_id: string;
  wallet_address: string;
  created_at: string;
};

export async function GET(request: Request) {
  const clientId = readClientId(request);
  if (!clientId) {
    return NextResponse.json({ error: "client id is required" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const result = await supabase
    .from("watchlist_wallets")
    .select("client_id,wallet_address,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (result.error) {
    return NextResponse.json({ error: "Failed to load watchlist" }, { status: 500 });
  }

  const wallets = (result.data as WatchlistRow[]).map((row) => row.wallet_address);
  return NextResponse.json({ wallets });
}

export async function POST(request: Request) {
  const clientId = readClientId(request);
  if (!clientId) {
    return NextResponse.json({ error: "client id is required" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const walletAddress = normalizeWallet(body?.walletAddress);
  if (!walletAddress) {
    return NextResponse.json({ error: "valid walletAddress is required" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const result = await supabase.from("watchlist_wallets").upsert(
    {
      client_id: clientId,
      wallet_address: walletAddress,
      created_at: new Date().toISOString(),
    },
    { onConflict: "client_id,wallet_address" }
  );

  if (result.error) {
    return NextResponse.json({ error: "Failed to add wallet" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const clientId = readClientId(request);
  if (!clientId) {
    return NextResponse.json({ error: "client id is required" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const walletAddress = normalizeWallet(body?.walletAddress);
  if (!walletAddress) {
    return NextResponse.json({ error: "valid walletAddress is required" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const result = await supabase
    .from("watchlist_wallets")
    .delete()
    .eq("client_id", clientId)
    .eq("wallet_address", walletAddress);

  if (result.error) {
    return NextResponse.json({ error: "Failed to remove wallet" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function getSupabase() {
  try {
    return createServerClient();
  } catch {
    return null;
  }
}

function readClientId(request: Request) {
  const url = new URL(request.url);
  const fromHeader = request.headers.get("x-client-id") || "";
  const fromQuery = url.searchParams.get("clientId") || "";
  const value = (fromHeader || fromQuery).trim();
  if (!value || value.length > 128) return null;
  return value;
}

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") return null;
  const wallet = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) return null;
  return wallet;
}
