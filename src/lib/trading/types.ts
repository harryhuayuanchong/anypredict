/* ═══════════════════════════════════════════════════════
   Platform-agnostic trading types
   Designed to support Polymarket, Predict.fun, Opinion Labs, etc.
   ═══════════════════════════════════════════════════════ */

export type OrderOutcome = "YES" | "NO";
export type OrderType = "GTC" | "GTD" | "FOK";
export type OrderStatus =
  | "pending"
  | "submitted"
  | "live"
  | "matched"
  | "filled"
  | "cancelled"
  | "expired"
  | "failed";

/** DB record shape for trade_orders table */
export interface TradeOrder {
  id: string;
  created_at: string;
  platform: string;
  external_order_id: string | null;
  run_id: string;
  batch_id: string | null;
  market_id: string;
  token_id: string;
  side: string;
  outcome: OrderOutcome;
  order_type: OrderType;
  price: number;
  size: number;
  size_usd: number;
  status: OrderStatus;
  fill_price: number | null;
  fill_size: number | null;
  fill_size_usd: number | null;
  dry_run: boolean;
  edge_at_placement: number | null;
  model_prob_at_placement: number | null;
  market_price_at_placement: number | null;
  submitted_at: string | null;
  filled_at: string | null;
  cancelled_at: string | null;
  error_message: string | null;
  platform_response: Record<string, unknown> | null;
}

/** Input required to execute a trade */
export interface TradeExecutionInput {
  run_id: string;
  batch_id: string | null;
  platform: string;
  market_id: string;
  token_id: string;
  outcome: OrderOutcome;
  price: number;
  size_usd: number;
  order_type: OrderType;
  neg_risk: boolean;
  tick_size: string;
  edge: number;
  model_prob: number;
  market_price: number;
}

/** Result from placing an order via a platform adapter */
export interface PlaceOrderResult {
  externalOrderId: string;
  status: OrderStatus;
  raw: Record<string, unknown>;
}

/** Result from checking order status */
export interface OrderStatusResult {
  status: OrderStatus;
  fillPrice: number | null;
  fillSize: number | null;
  raw: Record<string, unknown>;
}

/** Platform adapter interface — implement per exchange */
export interface TradingPlatformAdapter {
  readonly platform: string;

  isConfigured(): boolean;
  initialize(): Promise<void>;

  // Market data
  getTokenId(marketId: string, outcome: OrderOutcome): Promise<string>;
  getTickSize(tokenId: string): Promise<string>;
  getMarketPrice(tokenId: string): Promise<number>;

  // Order lifecycle
  placeOrder(input: TradeExecutionInput): Promise<PlaceOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<OrderStatusResult>;
  cancelOrder(externalOrderId: string): Promise<boolean>;

  // Balance
  getBalance(): Promise<{ usdc: number; address: string }>;
}
