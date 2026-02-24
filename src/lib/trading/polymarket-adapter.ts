/* ═══════════════════════════════════════════════════════
   Polymarket CLOB adapter
   Wraps @polymarket/clob-client for order placement
   ═══════════════════════════════════════════════════════ */

import { ethers } from "ethers";
import { ClobClient, Side, OrderType as ClobOrderType } from "@polymarket/clob-client";
import type { TickSize } from "@polymarket/clob-client";
import type {
  TradingPlatformAdapter,
  TradeExecutionInput,
  PlaceOrderResult,
  OrderStatusResult,
  OrderOutcome,
  OrderStatus,
} from "./types";

// USDC.e on Polygon
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// Map CLOB status strings to our OrderStatus
const STATUS_MAP: Record<string, OrderStatus> = {
  LIVE: "live",
  MATCHED: "matched",
  DELAYED: "submitted",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

function getEnv(key: string, fallback?: string): string {
  const val = process.env[key];
  if (!val && fallback === undefined) {
    throw new Error(`Missing env var: ${key}`);
  }
  return val || fallback || "";
}

/** Resolve Polygon RPC URL: POLYMARKET_RPC_URL > DRPC > public fallback */
function resolveRpcUrl(): string {
  if (process.env.POLYMARKET_RPC_URL) return process.env.POLYMARKET_RPC_URL;
  if (process.env.DRPC_API_KEY) return `https://lb.drpc.live/polygon/${process.env.DRPC_API_KEY}`;
  return "https://polygon-bor-rpc.publicnode.com";
}

export class PolymarketAdapter implements TradingPlatformAdapter {
  readonly platform = "polymarket";

  private client: ClobClient | null = null;
  private wallet: ethers.Wallet | null = null;
  private provider: ethers.providers.JsonRpcProvider | null = null;

  isConfigured(): boolean {
    return !!process.env.POLYMARKET_PRIVATE_KEY;
  }

  /** Light init: wallet + provider only (no CLOB API calls) */
  initWallet(): void {
    if (this.wallet) return;

    const privateKey = getEnv("POLYMARKET_PRIVATE_KEY");
    const chainId = parseInt(getEnv("POLYMARKET_CHAIN_ID", "137"));
    const rpcUrl = resolveRpcUrl();

    // Use StaticJsonRpcProvider to skip eth_chainId auto-detect.
    // Pass ConnectionInfo with skipFetchSetup so ethers v5 doesn't clash
    // with Next.js patched fetch (which adds caching headers / alters responses).
    const connection: ethers.utils.ConnectionInfo = {
      url: rpcUrl,
      skipFetchSetup: true,
    };
    this.provider = new ethers.providers.StaticJsonRpcProvider(connection, {
      chainId,
      name: "matic",
    });
    this.wallet = new ethers.Wallet(privateKey, this.provider);
  }

  /** Expose provider for external use (e.g. checking native USDC balance) */
  getProvider(): ethers.providers.JsonRpcProvider | null {
    return this.provider;
  }

  /** Full init: wallet + CLOB client with API credentials (calls CLOB server) */
  async initialize(): Promise<void> {
    if (this.client) return;

    // Ensure wallet is ready
    this.initWallet();

    const chainId = parseInt(getEnv("POLYMARKET_CHAIN_ID", "137"));

    // Create CLOB client with API key derivation
    // The CLOB client will derive API credentials from the wallet signature
    this.client = new ClobClient(
      "https://clob.polymarket.com",
      chainId,
      this.wallet!
    );

    // Derive or create API key credentials
    // This calls the CLOB server to derive HMAC creds from the wallet signature
    const creds = await this.client.createOrDeriveApiKey();

    // Re-create client with API credentials for authenticated endpoints
    this.client = new ClobClient(
      "https://clob.polymarket.com",
      chainId,
      this.wallet!,
      creds
    );
  }

  async getTokenId(
    marketId: string,
    outcome: OrderOutcome
  ): Promise<string> {
    // Fetch from Gamma API
    const res = await fetch(
      `https://gamma-api.polymarket.com/markets/${marketId}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`Failed to fetch market ${marketId}`);

    const market = await res.json();
    const tokenIds =
      typeof market.clobTokenIds === "string"
        ? JSON.parse(market.clobTokenIds)
        : market.clobTokenIds;

    if (!Array.isArray(tokenIds) || tokenIds.length < 2) {
      throw new Error(`No CLOB token IDs for market ${marketId}`);
    }

    return outcome === "YES" ? tokenIds[0] : tokenIds[1];
  }

  async getTickSize(tokenId: string): Promise<string> {
    this.ensureClient();
    // Fetch market info from CLOB API
    const res = await fetch(
      `https://clob.polymarket.com/markets/${tokenId}`
    );
    if (!res.ok) {
      // Default tick size for Polymarket
      return "0.01";
    }
    const data = await res.json();
    return data.minimum_tick_size || "0.01";
  }

  async getMarketPrice(tokenId: string): Promise<number> {
    this.ensureClient();
    const res = await fetch(
      `https://clob.polymarket.com/midpoint?token_id=${tokenId}`
    );
    if (!res.ok) throw new Error(`Failed to get price for ${tokenId}`);
    const data = await res.json();
    return parseFloat(data.mid) || 0;
  }

  async placeOrder(input: TradeExecutionInput): Promise<PlaceOrderResult> {
    this.ensureClient();

    const size = input.size_usd / input.price;

    // Build order params
    const orderArgs = {
      tokenID: input.token_id,
      price: input.price,
      size,
      side: Side.BUY,
    };

    // CreateOrderOptions: tickSize required, negRisk optional
    const createOptions: { tickSize: TickSize; negRisk?: boolean } = {
      tickSize: (input.tick_size || "0.01") as TickSize,
    };
    if (input.neg_risk) {
      createOptions.negRisk = true;
    }

    // Create signed order with options, then post with order type
    const signedOrder = await this.client!.createOrder(orderArgs, createOptions);
    const response = await this.client!.postOrder(signedOrder, ClobOrderType.GTC);

    return {
      externalOrderId: response.orderID || response.id || "",
      status: response.status === "LIVE" ? "live" : "submitted",
      raw: response as unknown as Record<string, unknown>,
    };
  }

  async getOrderStatus(externalOrderId: string): Promise<OrderStatusResult> {
    this.ensureClient();

    const res = await fetch(
      `https://clob.polymarket.com/orders/${externalOrderId}`
    );
    if (!res.ok) {
      return { status: "failed", fillPrice: null, fillSize: null, raw: {} };
    }

    const order = await res.json();
    const status = STATUS_MAP[order.status] || "submitted";

    return {
      status,
      fillPrice: order.associate_trades?.[0]?.price
        ? parseFloat(order.associate_trades[0].price)
        : null,
      fillSize: order.size_matched
        ? parseFloat(order.size_matched)
        : null,
      raw: order,
    };
  }

  async cancelOrder(externalOrderId: string): Promise<boolean> {
    this.ensureClient();
    try {
      await this.client!.cancelOrder({ orderID: externalOrderId });
      return true;
    } catch {
      return false;
    }
  }

  async getBalance(): Promise<{ usdc: number; address: string }> {
    this.ensureWallet();

    const usdc = new ethers.Contract(
      USDC_ADDRESS,
      USDC_ABI,
      this.provider!
    );

    const address = await this.wallet!.getAddress();
    const balance = await usdc.balanceOf(address);
    const decimals = await usdc.decimals();
    const formatted = parseFloat(ethers.utils.formatUnits(balance, decimals));

    return { usdc: formatted, address };
  }

  // ─── Helpers ───

  private ensureClient(): void {
    if (!this.client) {
      throw new Error("Polymarket adapter not initialized. Call initialize() first.");
    }
  }

  private ensureWallet(): void {
    if (!this.wallet || !this.provider) {
      throw new Error("Polymarket adapter not initialized. Call initialize() first.");
    }
  }
}

/** Singleton accessor — reset on HMR in dev */
let _instance: PolymarketAdapter | null = null;
let _instanceRpc: string | undefined;

export function getPolymarketAdapter(): PolymarketAdapter {
  // In dev, recreate if RPC env changed (e.g. after .env.local edit)
  const currentRpc = resolveRpcUrl();
  if (!_instance || _instanceRpc !== currentRpc) {
    _instance = new PolymarketAdapter();
    _instanceRpc = currentRpc;
  }
  return _instance;
}
