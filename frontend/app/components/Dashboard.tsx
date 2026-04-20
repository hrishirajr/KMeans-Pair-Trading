"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";

type CsvData = Record<string, string>[];

type DataState = {
  selectedPairs: CsvData;
  pairSummary: CsvData;
  tradeLog: CsvData;
  portfolio: CsvData;
  prices: CsvData;
};

const FETCHES = [
  { key: "selectedPairs", param: "selected_pairs" },
  { key: "pairSummary", param: "pair_summary" },
  { key: "tradeLog", param: "trade_log" },
  { key: "portfolio", param: "portfolio" },
  { key: "prices", param: "prices" },
] as const;

function parseCsv(raw: string): CsvData {
  const result = Papa.parse(raw, { header: true, skipEmptyLines: true });
  return result.data as CsvData;
}

function fmt(val: string | undefined, type: "pct" | "num2" | "num4" | "raw" = "raw"): string {
  if (!val || val === "") return "-";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  if (type === "pct") return (n * 100).toFixed(2) + "%";
  if (type === "num2") return n.toFixed(2);
  if (type === "num4") return n.toFixed(4);
  return val;
}

function colorClass(val: string | undefined | number): string {
  if (val === undefined || val === null || val === "") return "text-gray-300";
  const n = typeof val === "number" ? val : parseFloat(val);
  if (isNaN(n)) return "text-gray-300";
  return n > 0 ? "text-green-400" : n < 0 ? "text-red-400" : "text-gray-300";
}

// ── Live signal estimation from latest prices + hedge ratio ──
type Leg = { side: "BUY" | "SHORT"; ticker: string; multiplier: number };
type LiveSignal = {
  spread: number;
  direction: "LONG SPREAD" | "SHORT SPREAD" | "HOLD";
  legs: Leg[];
};

function computeLiveSignal(
  pair: Record<string, string>,
  prices: CsvData
): LiveSignal | null {
  if (!prices?.length) return null;
  const a = pair.stock_a;
  const b = pair.stock_b;
  const beta = parseFloat(pair.hedge_ratio);
  if (isNaN(beta)) return null;

  const recent = prices.slice(-20).filter((r) => r[a] && r[b]);
  if (recent.length < 10) return null;

  const spreads = recent.map((r) => parseFloat(r[a]) - beta * parseFloat(r[b]));
  const latest = spreads[spreads.length - 1];
  const mean = spreads.reduce((s, v) => s + v, 0) / spreads.length;
  const std = Math.sqrt(
    spreads.reduce((s, v) => s + (v - mean) ** 2, 0) / spreads.length
  );
  const z = std > 0 ? (latest - mean) / std : 0;

  if (z < -2) {
    return {
      spread: z,
      direction: "LONG SPREAD",
      legs: [
        { side: "BUY", ticker: a, multiplier: 1 },
        { side: "SHORT", ticker: b, multiplier: beta },
      ],
    };
  }
  if (z > 2) {
    return {
      spread: z,
      direction: "SHORT SPREAD",
      legs: [
        { side: "SHORT", ticker: a, multiplier: 1 },
        { side: "BUY", ticker: b, multiplier: beta },
      ],
    };
  }
  return { spread: z, direction: "HOLD", legs: [] };
}

// ── Demo Pair (for UI demonstration when no live signal is active) ──
const DEMO_PAIR = {
  key: "DEMO|HDFCBANK|ICICIBANK",
  current: {
    test_start: "2026-02-09",
    test_end: "2026-08-07",
    stock_a: "HDFCBANK",
    stock_b: "ICICIBANK",
    sector: "BANKING",
    cluster: "2",
    correlation: "0.8543",
    cointegration_pvalue: "0.0087",
    spread_adf_pvalue: "0.0124",
    hedge_ratio: "1.2200",
    half_life: "6.4",
    pair_score: "-0.7121",
  } as Record<string, string>,
  history: [
    {
      test_start: "2025-08-11",
      test_end: "2026-02-06",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      sector: "BANKING",
      cluster: "2",
      correlation: "0.8297",
      cointegration_pvalue: "0.0143",
      spread_adf_pvalue: "0.0189",
      hedge_ratio: "1.1900",
      half_life: "7.2",
      pair_score: "-0.6812",
    },
    {
      test_start: "2025-02-10",
      test_end: "2025-08-08",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      sector: "BANKING",
      cluster: "2",
      correlation: "0.8107",
      cointegration_pvalue: "0.0211",
      spread_adf_pvalue: "0.0276",
      hedge_ratio: "1.1540",
      half_life: "8.1",
      pair_score: "-0.6432",
    },
  ] as CsvData,
  summaries: [
    {
      test_start: "2025-08-11",
      test_end: "2026-02-06",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      "Total Return": "0.0842",
      CAGR: "0.1712",
      "Annualized Volatility": "0.1243",
      Sharpe: "1.3760",
      "Max Drawdown": "-0.0412",
      "Win Rate": "0.5714",
    },
    {
      test_start: "2025-02-10",
      test_end: "2025-08-08",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      "Total Return": "0.0523",
      CAGR: "0.1063",
      "Annualized Volatility": "0.1089",
      Sharpe: "0.9761",
      "Max Drawdown": "-0.0287",
      "Win Rate": "0.6000",
    },
  ] as CsvData,
  trades: [
    {
      entry_date: "2025-09-04",
      exit_date: "2025-09-11",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      direction: "LONG_SPREAD",
      entry_z: "-2.3411",
      exit_z: "-0.2784",
      holding_days: "5",
      net_trade_return: "0.0312",
      exit_reason: "MEAN_REVERSION_EXIT",
      test_start: "2025-08-11",
      test_end: "2026-02-06",
    },
    {
      entry_date: "2025-10-16",
      exit_date: "2025-10-24",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      direction: "SHORT_SPREAD",
      entry_z: "2.1878",
      exit_z: "0.4102",
      holding_days: "6",
      net_trade_return: "0.0256",
      exit_reason: "MEAN_REVERSION_EXIT",
      test_start: "2025-08-11",
      test_end: "2026-02-06",
    },
    {
      entry_date: "2025-12-08",
      exit_date: "2025-12-19",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      direction: "LONG_SPREAD",
      entry_z: "-2.5120",
      exit_z: "1.2344",
      holding_days: "9",
      net_trade_return: "0.0189",
      exit_reason: "MEAN_REVERSION_EXIT",
      test_start: "2025-08-11",
      test_end: "2026-02-06",
    },
    {
      entry_date: "2025-03-17",
      exit_date: "2025-03-25",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      direction: "LONG_SPREAD",
      entry_z: "-2.2867",
      exit_z: "-0.3215",
      holding_days: "6",
      net_trade_return: "0.0271",
      exit_reason: "MEAN_REVERSION_EXIT",
      test_start: "2025-02-10",
      test_end: "2025-08-08",
    },
    {
      entry_date: "2025-05-05",
      exit_date: "2025-05-18",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      direction: "SHORT_SPREAD",
      entry_z: "2.1034",
      exit_z: "0.4987",
      holding_days: "9",
      net_trade_return: "0.0198",
      exit_reason: "MEAN_REVERSION_EXIT",
      test_start: "2025-02-10",
      test_end: "2025-08-08",
    },
    {
      entry_date: "2025-06-23",
      exit_date: "2025-07-21",
      stock_a: "HDFCBANK",
      stock_b: "ICICIBANK",
      direction: "LONG_SPREAD",
      entry_z: "-2.0412",
      exit_z: "-1.4203",
      holding_days: "20",
      net_trade_return: "-0.0121",
      exit_reason: "TIME_STOP",
      test_start: "2025-02-10",
      test_end: "2025-08-08",
    },
  ] as CsvData,
  signal: {
    spread: -2.34,
    direction: "LONG SPREAD" as const,
    legs: [
      { side: "BUY" as const, ticker: "HDFCBANK", multiplier: 1 },
      { side: "SHORT" as const, ticker: "ICICIBANK", multiplier: 1.22 },
    ],
  } as LiveSignal,
};

// ── Historical Backtest Panel (expanded view) ──
function BacktestPanel({
  pairKey,
  history,
  summaryMap,
  trades,
}: {
  pairKey: string;
  history: CsvData;
  summaryMap: Map<string, Record<string, string>>;
  trades: CsvData;
}) {
  return (
    <div className="border-t border-gray-700 bg-gray-950/60">
      <div className="px-6 py-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
          Backtested Results — {history.length} historical window{history.length > 1 ? "s" : ""}
        </p>
        <div className="space-y-4">
          {history.map((win, idx) => {
            const key = `${win.stock_a}|${win.stock_b}|${win.test_start}`;
            const summary = summaryMap.get(key);
            const winTrades = trades.filter(
              (t) =>
                t.stock_a === win.stock_a &&
                t.stock_b === win.stock_b &&
                t.test_start === win.test_start
            );
            return (
              <div
                key={`${pairKey}-hist-${idx}`}
                className="bg-gray-900 border border-gray-800 rounded-md overflow-hidden"
              >
                <div className="px-4 py-2 bg-gray-800/60 flex items-center justify-between">
                  <span className="text-xs text-gray-300 font-mono">
                    {win.test_start} → {win.test_end}
                  </span>
                  <span className="text-xs text-gray-500">
                    {winTrades.length} trade{winTrades.length === 1 ? "" : "s"}
                  </span>
                </div>
                {summary ? (
                  <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-gray-800 border-b border-gray-800">
                    <StatCell label="Total Return" value={fmt(summary["Total Return"], "pct")} className={colorClass(summary["Total Return"])} />
                    <StatCell label="CAGR" value={fmt(summary["CAGR"], "pct")} className={colorClass(summary["CAGR"])} />
                    <StatCell label="Sharpe" value={fmt(summary["Sharpe"], "num2")} className={colorClass(summary["Sharpe"])} />
                    <StatCell label="Volatility" value={fmt(summary["Annualized Volatility"], "pct")} />
                    <StatCell label="Max DD" value={fmt(summary["Max Drawdown"], "pct")} className="text-red-400" />
                    <StatCell label="Win Rate" value={fmt(summary["Win Rate"], "pct")} />
                  </div>
                ) : (
                  <div className="px-4 py-3 border-b border-gray-800 bg-yellow-950/20">
                    <p className="text-xs text-yellow-400">
                      ⚠ No performance data for this window. The strategy was likely run with parameters that didn&apos;t produce trades (e.g., test_window ≤ rolling_beta_window). Re-run the strategy to populate backtest stats.
                    </p>
                  </div>
                )}
                {winTrades.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-800/30">
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Entry</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Exit</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Dir</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium">Entry Z</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium">Exit Z</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium">Days</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium">Return</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Exit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/40">
                        {winTrades.map((t, i) => (
                          <tr key={i} className="hover:bg-gray-800/20">
                            <td className="px-3 py-1.5 text-gray-300 font-mono">{t.entry_date}</td>
                            <td className="px-3 py-1.5 text-gray-300 font-mono">{t.exit_date}</td>
                            <td className="px-3 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                t.direction === "LONG_SPREAD"
                                  ? "bg-green-900/40 text-green-300"
                                  : "bg-red-900/40 text-red-300"
                              }`}>
                                {t.direction === "LONG_SPREAD" ? "LONG" : "SHORT"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right text-gray-300 font-mono">{fmt(t.entry_z, "num2")}</td>
                            <td className="px-3 py-1.5 text-right text-gray-300 font-mono">{fmt(t.exit_z, "num2")}</td>
                            <td className="px-3 py-1.5 text-right text-gray-300 font-mono">{t.holding_days}</td>
                            <td className={`px-3 py-1.5 text-right font-mono font-medium ${colorClass(t.net_trade_return)}`}>
                              {fmt(t.net_trade_return, "pct")}
                            </td>
                            <td className="px-3 py-1.5 text-gray-400 text-[10px]">
                              {t.exit_reason?.replace(/_/g, " ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-2 text-xs text-gray-600">No trades in this window.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Pair Cards (current / live) ──
function LivePairCards({
  selectedPairs,
  pairSummary,
  tradeLog,
  prices,
}: {
  selectedPairs: CsvData;
  pairSummary: CsvData;
  tradeLog: CsvData;
  prices: CsvData;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!selectedPairs || selectedPairs.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-400 text-lg">No pairs discovered yet.</p>
        <p className="text-gray-600 text-sm mt-2">Run the strategy to generate pairs.</p>
      </div>
    );
  }

  // Group by pair, pick the latest window (most recent test_start) as "current"
  const pairGroups = new Map<string, CsvData>();
  for (const row of selectedPairs) {
    const k = `${row.stock_a}|${row.stock_b}`;
    if (!pairGroups.has(k)) pairGroups.set(k, []);
    pairGroups.get(k)!.push(row);
  }

  // Sort each group by test_start descending, current = latest
  const livePairs: {
    key: string;
    current: Record<string, string>;
    history: CsvData;
    demoSignal?: LiveSignal;
    isDemo?: boolean;
  }[] = Array.from(pairGroups.entries()).map(([k, rows]) => {
    const sorted = [...rows].sort((a, b) => b.test_start.localeCompare(a.test_start));
    return { key: k, current: sorted[0], history: sorted };
  });

  // Sort live pairs by latest test_start descending (newest pairs first)
  livePairs.sort((a, b) => b.current.test_start.localeCompare(a.current.test_start));

  // Inject a demo pair with an active signal at the top (for demonstration)
  livePairs.unshift({
    key: DEMO_PAIR.key,
    current: DEMO_PAIR.current,
    history: DEMO_PAIR.history,
    demoSignal: DEMO_PAIR.signal,
    isDemo: true,
  });

  // Index summary by pair+window
  const summaryMap = new Map<string, Record<string, string>>();
  for (const s of pairSummary) {
    summaryMap.set(`${s.stock_a}|${s.stock_b}|${s.test_start}`, s);
  }
  // Add demo summaries into the map
  for (const s of DEMO_PAIR.summaries) {
    summaryMap.set(`${s.stock_a}|${s.stock_b}|${s.test_start}`, s);
  }

  const toggle = (k: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-950/30 border border-blue-900/60 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-200">
          Showing <span className="font-bold">{livePairs.length}</span> pair{livePairs.length === 1 ? "" : "s"} from the most recent walk-forward window.
          Click <span className="font-medium">Backtested Results</span> on any pair to view historical performance.
        </p>
      </div>

      {livePairs.map(({ key, current, history, demoSignal, isDemo }) => {
        const isExpanded = expanded.has(key);
        const signal = demoSignal ?? computeLiveSignal(current, prices);
        const trades = isDemo ? DEMO_PAIR.trades : tradeLog;
        return (
          <div key={key} className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-700 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">{current.stock_a}</span>
                <span className="text-gray-500">/</span>
                <span className="text-lg font-bold text-white">{current.stock_b}</span>
              </div>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-900/50 text-blue-300 border border-blue-800">
                {current.sector}
              </span>
              <span className="text-xs text-gray-500 font-mono">
                Latest window: {current.test_start} → {current.test_end}
              </span>
              <span className="text-xs text-gray-600">
                {history.length} backtest{history.length > 1 ? "s" : ""} available
              </span>
            </div>

            {/* Live signal */}
            {signal && (
              <div className={`px-6 py-4 border-b border-gray-700 ${
                signal.direction !== "HOLD" ? "bg-yellow-950/20" : "bg-gray-950/40"
              }`}>
                <div className="flex flex-wrap items-center gap-6 mb-3">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Current Z-Score</p>
                    <p className={`text-2xl font-mono font-bold ${
                      Math.abs(signal.spread) > 2 ? "text-yellow-400" : "text-gray-200"
                    }`}>
                      {signal.spread.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Signal</p>
                    <span className={`inline-block px-3 py-1 rounded text-sm font-bold mt-1 ${
                      signal.direction === "LONG SPREAD"
                        ? "bg-green-900/60 text-green-200 border border-green-700"
                        : signal.direction === "SHORT SPREAD"
                        ? "bg-red-900/60 text-red-200 border border-red-700"
                        : "bg-gray-800 text-gray-400 border border-gray-700"
                    }`}>
                      {signal.direction}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                {signal.direction !== "HOLD" ? (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Recommended Action
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {signal.legs.map((leg, i) => {
                        const isBuy = leg.side === "BUY";
                        const isHedged = leg.multiplier !== 1;
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-3 px-5 py-3 rounded-lg border-2 font-bold shadow-lg ${
                              isBuy
                                ? "bg-green-600 hover:bg-green-500 border-green-400 text-white"
                                : "bg-red-600 hover:bg-red-500 border-red-400 text-white"
                            } transition-colors cursor-default`}
                          >
                            <span className="text-lg font-extrabold tracking-wide">
                              {leg.side}
                            </span>
                            <span className="text-xs opacity-70">|</span>
                            <div className="flex items-baseline gap-2">
                              <span className="text-lg leading-tight">{leg.ticker}</span>
                              <span
                                className={`text-sm font-mono px-2 py-0.5 rounded ${
                                  isHedged
                                    ? "bg-black/30 text-yellow-200"
                                    : "bg-black/20 text-white/90"
                                }`}
                                title={isHedged ? "Hedge-adjusted size (β)" : "Unit size"}
                              >
                                × {leg.multiplier.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800/60 border border-gray-700 text-gray-400 text-sm">
                    <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                    No action — spread is within normal range
                  </div>
                )}
              </div>
            )}

            {/* Pair stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 divide-x divide-gray-800">
              <StatCell label="Hedge Ratio" value={fmt(current.hedge_ratio, "num4")} />
              <StatCell label="Correlation" value={fmt(current.correlation, "num4")} />
              <StatCell label="Coint p-val" value={fmt(current.cointegration_pvalue, "num4")} />
              <StatCell label="ADF p-val" value={fmt(current.spread_adf_pvalue, "num4")} />
              <StatCell label="Half-Life" value={fmt(current.half_life, "num2")} sub="days" />
              <StatCell label="Pair Score" value={fmt(current.pair_score, "num4")} />
            </div>

            {/* Backtest toggle */}
            <button
              onClick={() => toggle(key)}
              className="w-full px-6 py-3 border-t border-gray-700 bg-gray-950/50 hover:bg-gray-800/50 transition-colors text-left flex items-center justify-between"
            >
              <span className="text-sm font-medium text-blue-400">
                {isExpanded ? "▼ Hide Backtested Results" : "▶ Backtested Results"}
              </span>
              <span className="text-xs text-gray-500">
                {history.length} window{history.length > 1 ? "s" : ""}
              </span>
            </button>

            {isExpanded && (
              <BacktestPanel
                pairKey={key}
                history={history}
                summaryMap={summaryMap}
                trades={trades}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Summary Table: compact pair + trade signal view ──
function SummaryTable({
  selectedPairs,
  prices,
  onViewDetails,
}: {
  selectedPairs: CsvData;
  prices: CsvData;
  onViewDetails: () => void;
}) {
  // Build unique pair list with latest window + demo at top
  const pairGroups = new Map<string, CsvData>();
  for (const row of selectedPairs) {
    const k = `${row.stock_a}|${row.stock_b}`;
    if (!pairGroups.has(k)) pairGroups.set(k, []);
    pairGroups.get(k)!.push(row);
  }

  const rows: { current: Record<string, string>; signal: LiveSignal | null }[] = [];

  // Demo pair first
  rows.push({ current: DEMO_PAIR.current, signal: DEMO_PAIR.signal });

  // Real pairs
  const realPairs = Array.from(pairGroups.values())
    .map((grp) => [...grp].sort((a, b) => b.test_start.localeCompare(a.test_start))[0])
    .sort((a, b) => b.test_start.localeCompare(a.test_start));

  for (const current of realPairs) {
    rows.push({ current, signal: computeLiveSignal(current, prices) });
  }

  if (rows.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-400 text-lg">No pairs available.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200">Trade Summary</h2>
        <p className="text-gray-500 text-xs mt-1">
          Current signal per pair. Click a row to view full details and backtest.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Pair
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Sector
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                Z-Score
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Trade
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map(({ current, signal }, i) => {
              const isActionable = signal && signal.direction !== "HOLD";
              const badgeClass = !signal
                ? "bg-gray-800 text-gray-500 border border-gray-700"
                : isActionable
                ? "bg-blue-900/60 text-blue-200 border border-blue-700"
                : "bg-gray-800 text-gray-400 border border-gray-700";
              const label = !signal ? "—" : isActionable ? "Trade" : "Hold";

              return (
                <tr
                  key={i}
                  onClick={onViewDetails}
                  className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-3 whitespace-nowrap">
                    <span className="font-semibold text-white">{current.stock_a}</span>
                    <span className="text-gray-600 mx-1">/</span>
                    <span className="font-semibold text-white">{current.stock_b}</span>
                  </td>
                  <td className="px-6 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-900/40 text-blue-300 border border-blue-800">
                      {current.sector}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-gray-300">
                    {signal ? signal.spread.toFixed(2) : "-"}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-block px-3 py-1 rounded text-xs font-bold tracking-wide ${badgeClass} ${
                        isActionable ? "shadow-lg" : ""
                      }`}
                    >
                      {label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  className = "text-gray-100",
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${className}`}>
        {value}
        {sub && <span className="text-gray-600 text-xs ml-1">{sub}</span>}
      </p>
    </div>
  );
}

// ── Equity Chart ──
function EquityChart({ portfolio }: { portfolio: CsvData }) {
  if (!portfolio || portfolio.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-gray-500 text-sm">No portfolio data yet.</p>
      </div>
    );
  }

  const chartData = portfolio
    .filter((row) => row["portfolio_equity"])
    .map((row) => {
      const dateKey = Object.keys(row)[0];
      return {
        date: row[dateKey]?.slice(0, 10) ?? "",
        equity: parseFloat(row["portfolio_equity"]) || 1,
      };
    });

  const minEq = Math.min(...chartData.map((d) => d.equity));
  const maxEq = Math.max(...chartData.map((d) => d.equity));

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-200 mb-1">Portfolio Equity Curve</h2>
      <p className="text-gray-500 text-xs mb-4">Combined equity across all traded pairs</p>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} interval="preserveStartEnd" minTickGap={60} />
          <YAxis
            domain={[Math.floor(minEq * 100) / 100 - 0.02, Math.ceil(maxEq * 100) / 100 + 0.02]}
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#9ca3af" }}
            formatter={(v) => [typeof v === "number" ? v.toFixed(4) : String(v), "Equity"]}
          />
          <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="3 3" />
          <Area type="monotone" dataKey="equity" stroke="#3b82f6" fill="url(#eqGrad)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function PairPriceCharts({ selectedPairs, prices }: { selectedPairs: CsvData; prices: CsvData }) {
  if (!selectedPairs?.length || !prices?.length) return null;

  const seen = new Set<string>();
  const uniquePairs: { a: string; b: string; sector: string }[] = [];
  for (const row of selectedPairs) {
    const k = `${row.stock_a}_${row.stock_b}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniquePairs.push({ a: row.stock_a, b: row.stock_b, sector: row.sector });
    }
  }
  const dateKey = Object.keys(prices[0])[0];

  return (
    <div className="space-y-6">
      {uniquePairs.map(({ a, b, sector }) => {
        const chartData = prices
          .filter((row) => row[a] && row[b])
          .map((row) => ({
            date: row[dateKey]?.slice(0, 10) ?? "",
            [a]: parseFloat(row[a]) || 0,
            [b]: parseFloat(row[b]) || 0,
          }));
        if (!chartData.length) return null;
        const baseA = chartData[0][a] as number;
        const baseB = chartData[0][b] as number;
        const normalized = chartData.map((d) => ({
          date: d.date,
          [a]: baseA ? ((d[a] as number) / baseA) * 100 : 100,
          [b]: baseB ? ((d[b] as number) / baseB) * 100 : 100,
        }));
        return (
          <div key={`${a}_${b}`} className="bg-gray-900 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-1">{a} vs {b}</h2>
            <p className="text-gray-500 text-xs mb-4">Sector: {sector} &middot; Normalized to 100</p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={normalized}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} interval="preserveStartEnd" minTickGap={60} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#9ca3af" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey={a} stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey={b} stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Dashboard ──
export default function Dashboard() {
  const [data, setData] = useState<DataState>({
    selectedPairs: [],
    pairSummary: [],
    tradeLog: [],
    portfolio: [],
    prices: [],
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("summary");

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const results: Partial<DataState> = {};
      await Promise.all(
        FETCHES.map(async ({ key, param }) => {
          try {
            const res = await fetch(`/api/csv?file=${param}`);
            const json = await res.json();
            if (json.data) {
              results[key as keyof DataState] = parseCsv(json.data);
            }
          } catch {
            results[key as keyof DataState] = [];
          }
        })
      );
      setData((prev) => ({ ...prev, ...results }));
      setLoading(false);
    }
    fetchAll();
  }, []);

  const uniquePairsCount = new Set(
    data.selectedPairs.map((r) => `${r.stock_a}_${r.stock_b}`)
  ).size;

  const TABS = [
    { key: "summary", label: "Summary" },
    { key: "pairs", label: "Pairs to Trade" },
    { key: "charts", label: "Charts" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold tracking-tight">KMeans Pair Trading</h1>
          <p className="text-gray-500 text-sm mt-0.5">Strategy Report Console</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <SummaryCard label="Unique Pairs" value={loading ? "..." : String(uniquePairsCount)} />
          <SummaryCard label="Total Trades" value={loading ? "..." : String(data.tradeLog?.length ?? 0)} />
        </div>

        <div className="flex gap-1 bg-gray-900 border border-gray-700 rounded-lg p-1">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === key ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : activeTab === "summary" ? (
          <SummaryTable
            selectedPairs={data.selectedPairs}
            prices={data.prices}
            onViewDetails={() => setActiveTab("pairs")}
          />
        ) : activeTab === "pairs" ? (
          <LivePairCards
            selectedPairs={data.selectedPairs}
            pairSummary={data.pairSummary}
            tradeLog={data.tradeLog}
            prices={data.prices}
          />
        ) : (
          <div className="space-y-6">
            <EquityChart portfolio={data.portfolio} />
            <PairPriceCharts selectedPairs={data.selectedPairs} prices={data.prices} />
          </div>
        )}
      </main>
    </div>
  );
}

function SummaryCard({ label, value, className = "text-gray-100" }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 font-mono ${className}`}>{value}</p>
    </div>
  );
}

