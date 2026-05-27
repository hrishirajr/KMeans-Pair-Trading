export type TradeStatus = "OPEN" | "CLOSED";
export type TradeDirection = "LONG SPREAD" | "SHORT SPREAD";
export type ExitReason = "MEAN_REVERSION" | "ZSCORE_STOP" | "MANUAL_CLOSE";

export type ActiveTrade = {
  id: string;
  pair: string;
  stockA: string;
  stockB: string;
  sector: string;
  direction: TradeDirection;
  hedgeRatio: number;
  entryZ: number;
  entryTimestamp: number;
  status: TradeStatus;
  exitZ?: number;
  exitTimestamp?: number;
  exitReason?: ExitReason;
};

export type TradeLogEntry = {
  timestamp: number;
  type: "OPEN" | "CLOSE" | "AUTO_EXIT" | "REFRESH";
  tradeId: string;
  pair: string;
  message: string;
  details?: Record<string, string | number>;
};

const TRADES_KEY = "kmeans.activeTrades.v1";
const LOG_KEY = "kmeans.tradeLog.v1";

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function getTrades(): ActiveTrade[] {
  return safeRead<ActiveTrade[]>(TRADES_KEY, []);
}

export function saveTrades(trades: ActiveTrade[]): void {
  safeWrite(TRADES_KEY, trades);
}

export function getLog(): TradeLogEntry[] {
  return safeRead<TradeLogEntry[]>(LOG_KEY, []);
}

export function appendLog(entry: TradeLogEntry): void {
  const log = getLog();
  log.unshift(entry);
  safeWrite(LOG_KEY, log.slice(0, 500));
}

export function openTrade(t: Omit<ActiveTrade, "id" | "status" | "entryTimestamp">): ActiveTrade {
  const trade: ActiveTrade = {
    ...t,
    id: `${t.pair}-${Date.now()}`,
    status: "OPEN",
    entryTimestamp: Date.now(),
  };
  const trades = getTrades();
  trades.unshift(trade);
  saveTrades(trades);
  appendLog({
    timestamp: trade.entryTimestamp,
    type: "OPEN",
    tradeId: trade.id,
    pair: trade.pair,
    message: `Opened ${trade.direction} on ${trade.pair} at z=${trade.entryZ.toFixed(2)}`,
    details: { entryZ: trade.entryZ, hedgeRatio: trade.hedgeRatio },
  });
  return trade;
}

export function closeTrade(
  id: string,
  exitZ: number,
  reason: ExitReason
): ActiveTrade | null {
  const trades = getTrades();
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const t = trades[idx];
  if (t.status === "CLOSED") return t;
  const closedAt = Date.now();
  trades[idx] = {
    ...t,
    status: "CLOSED",
    exitZ,
    exitTimestamp: closedAt,
    exitReason: reason,
  };
  saveTrades(trades);
  appendLog({
    timestamp: closedAt,
    type: reason === "MANUAL_CLOSE" ? "CLOSE" : "AUTO_EXIT",
    tradeId: id,
    pair: t.pair,
    message:
      reason === "MANUAL_CLOSE"
        ? `Manually closed ${t.pair} at z=${exitZ.toFixed(2)}`
        : `Auto-exit ${t.pair} at z=${exitZ.toFixed(2)} (${reason})`,
    details: { exitZ, entryZ: t.entryZ, holdMs: closedAt - t.entryTimestamp },
  });
  return trades[idx];
}

export function logRefresh(snapshot: { tradeId: string; pair: string; currentZ: number }[]): void {
  appendLog({
    timestamp: Date.now(),
    type: "REFRESH",
    tradeId: "*",
    pair: "*",
    message: `Refreshed ${snapshot.length} active trade${snapshot.length === 1 ? "" : "s"}`,
    details: { count: snapshot.length },
  });
}
