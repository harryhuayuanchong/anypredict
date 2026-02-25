export type LeaderboardRow = {
  rank: number | null;
  name: string | null;
  address: string | null;
  pnl: number;
  volume: number;
  event: string | null;
  positionsCount: number | null;
  positionsValue: number | null;
  isSmartMoney: boolean;
  isVerified: boolean;
  labels: LabelEntry[];
};

export type LabelEntry = {
  address_name?: string;
  label?: string;
  label_type?: string;
  label_subtype?: string;
};

export type SortState = {
  key: "pnl" | "volume";
  direction: "asc" | "desc";
};

export type AiSummary = {
  performanceSnapshot: string;
  holdingBehavior: string;
  tradePattern: string;
  categoryEdge: string;
};

export type SummaryPayload = {
  walletAddress: string;
  realizedPnl: number;
  lifetimeVolume: number;
  openPositions: number;
  openPositionsValue: number;
  trades: number;
  buys: number;
  sells: number;
  topPositionTitle: string | null;
  topPositionValue: number;
  winRate: number | null;
  categoryHint: string | null;
};

export type WalletModalData = {
  name: string;
  joined: string;
  addressShort: string;
  address: string;
  lifetimePnl: string;
  lifetimeVol: string;
  lifetimePnlNeg: boolean;
  positionsCount: string;
  positionsValue: string;
  tradesCount: string;
  // Structured data (replaces dangerouslySetInnerHTML)
  tradeSummary: TradeSummaryData | null;
  positionSummary: PositionSummaryData | null;
  positions: PositionItem[];
  history: HistoryItem[];
  chartPoints: ChartPoint[];
  chartValue: string;
  // AI summary
  aiSummaryLoading: boolean;
  aiSummaryError: string;
  aiSummarySource: string;
  aiSummaryUpdatedAt: string;
  aiSummaryCategory: string;
  aiSummaryEvent: string;
  aiSummary: AiSummary;
};

export type TradeSummaryData = {
  totalTrades: number;
  buys: number;
  sells: number;
  volume: number;
};

export type PositionSummaryData = {
  openPositions: number;
  totalValue: number;
  largestTitle: string;
  largestValue: number;
};

export type PositionItem = {
  title: string;
  outcome: string;
  value: number;
  pnl: number;
  market?: string;
  shares?: number;
};

export type HistoryItem = {
  title: string;
  side: string;
  size: number;
  time: string;
  status?: string;
  market?: string;
};

export type ChartPoint = {
  time: number;
  value: number;
};

export type CacheEntry<T> = {
  value: T;
  timestamp: number;
};

export type Category =
  | "OVERALL"
  | "POLITICS"
  | "SPORTS"
  | "CLIMATE"
  | "GEOPOLITICS"
  | "TECH"
  | "CRYPTO"
  | "ECONOMICS"
  | "CULTURE";

export type TimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";
