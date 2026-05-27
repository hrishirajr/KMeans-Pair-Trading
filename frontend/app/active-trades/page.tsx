"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ActiveTrade,
  TradeLogEntry,
  getTrades,
  getLog,
  closeTrade,
  logRefresh,
} from "@/lib/trades";
import { computeCurrentZ, fetchCsv, CsvData } from "@/lib/csv";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const Z_EXIT = 0.5; // mean-reversion exit threshold
const Z_STOP = 3.5; // stop-loss threshold

function fmtTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function ActiveTradesPage() {
  const [trades, setTrades] = useState<ActiveTrade[]>([]);
  const [log, setLog] = useState<TradeLogEntry[]>([]);
  const [prices, setPrices] = useState<CsvData>([]);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const reload = useCallback(() => {
    setTrades(getTrades());
    setLog(getLog());
  }, []);

  // Initial load + listen for storage changes from other tabs
  useEffect(() => {
    reload();
    fetchCsv("prices.csv").then(setPrices);
    const onStorage = () => reload();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload]);

  // Cron-style refresh every 10 minutes — checks z-scores, auto-exits if exit/stop hit
  useEffect(() => {
    if (!prices.length) return;

    const tick = () => {
      const open = getTrades().filter((t) => t.status === "OPEN");
      const snapshot: { tradeId: string; pair: string; currentZ: number }[] = [];
      for (const t of open) {
        const z = computeCurrentZ(t.stockA, t.stockB, t.hedgeRatio, prices);
        if (z === null) continue;
        snapshot.push({ tradeId: t.id, pair: t.pair, currentZ: z });

        const reverted =
          (t.direction === "LONG SPREAD" && z >= -Z_EXIT) ||
          (t.direction === "SHORT SPREAD" && z <= Z_EXIT);
        const stopped = Math.abs(z) > Z_STOP;
        if (reverted) {
          closeTrade(t.id, z, "MEAN_REVERSION");
        } else if (stopped) {
          closeTrade(t.id, z, "ZSCORE_STOP");
        }
      }
      if (snapshot.length) logRefresh(snapshot);
      setLastRefresh(Date.now());
      reload();
    };

    tick(); // initial check
    const id = setInterval(tick, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [prices, reload]);

  const handleClose = (id: string) => {
    const t = trades.find((x) => x.id === id);
    if (!t) return;
    const currentZ =
      computeCurrentZ(t.stockA, t.stockB, t.hedgeRatio, prices) ?? t.entryZ;
    closeTrade(id, currentZ, "MANUAL_CLOSE");
    reload();
  };

  const openTrades = trades.filter((t) => t.status === "OPEN");
  const closedTrades = trades.filter((t) => t.status === "CLOSED");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Active Trades</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Auto-refresh every 10 min · Last check: {fmtTimeAgo(lastRefresh)}
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <SummaryCard label="Open Trades" value={String(openTrades.length)} />
          <SummaryCard label="Closed Trades" value={String(closedTrades.length)} />
          <SummaryCard label="Log Entries" value={String(log.length)} />
        </div>

        {/* Open Trades */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-gray-200">Open Trades</h2>
            <p className="text-gray-500 text-xs mt-1">
              Trades currently active. Z-score auto-checked every 10 min and exits when |z| reaches mean-reversion ({Z_EXIT}) or stop ({Z_STOP}).
            </p>
          </div>
          {openTrades.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500 text-sm">
              No open trades. Click <span className="font-medium text-gray-300">Take Trade</span> on any actionable pair from the dashboard.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Pair</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Direction</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Entry Z</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Current Z</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Hedge β</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Opened</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {openTrades.map((t) => {
                    const currentZ = computeCurrentZ(t.stockA, t.stockB, t.hedgeRatio, prices);
                    const zClass =
                      currentZ === null
                        ? "text-gray-500"
                        : Math.abs(currentZ) > Z_STOP
                        ? "text-red-400"
                        : Math.abs(currentZ) < Z_EXIT
                        ? "text-green-400"
                        : "text-gray-300";
                    return (
                      <tr key={t.id} className="hover:bg-gray-800/40">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-semibold text-white">{t.stockA}</span>
                          <span className="text-gray-600 mx-1">/</span>
                          <span className="font-semibold text-white">{t.stockB}</span>
                          <span className="ml-2 text-[10px] text-gray-500">{t.sector}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-bold ${
                              t.direction === "LONG SPREAD"
                                ? "bg-green-900/60 text-green-200 border border-green-700"
                                : "bg-red-900/60 text-red-200 border border-red-700"
                            }`}
                          >
                            {t.direction}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-300">
                          {t.entryZ.toFixed(2)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${zClass}`}>
                          {currentZ === null ? "-" : currentZ.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-400">
                          {t.hedgeRatio.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {fmtTimeAgo(t.entryTimestamp)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleClose(t.id)}
                            className="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-bold transition-colors"
                          >
                            Close Trade
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Closed Trades */}
        {closedTrades.length > 0 && (
          <section className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-700">
              <h2 className="text-lg font-semibold text-gray-200">Closed Trades</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Pair</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Direction</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Entry Z</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Exit Z</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Closed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {closedTrades.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-semibold text-white">{t.stockA}</span>
                        <span className="text-gray-600 mx-1">/</span>
                        <span className="font-semibold text-white">{t.stockB}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{t.direction}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-300">{t.entryZ.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-300">{t.exitZ?.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-medium ${
                            t.exitReason === "MEAN_REVERSION"
                              ? "text-green-400"
                              : t.exitReason === "ZSCORE_STOP"
                              ? "text-red-400"
                              : "text-yellow-400"
                          }`}
                        >
                          {t.exitReason?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {t.exitTimestamp ? fmtTime(t.exitTimestamp) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Logs */}
        <section className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-gray-200">Activity Log</h2>
            <p className="text-gray-500 text-xs mt-1">
              Records of every open, close, auto-exit, and refresh event.
            </p>
          </div>
          {log.length === 0 ? (
            <div className="px-6 py-6 text-center text-gray-500 text-sm">No activity yet.</div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Time</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Event</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Pair</th>
                    <th className="px-4 py-2 text-left text-gray-400 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {log.map((entry, i) => (
                    <tr key={i}>
                      <td className="px-4 py-1.5 text-gray-500 font-mono whitespace-nowrap">
                        {fmtTime(entry.timestamp)}
                      </td>
                      <td className="px-4 py-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            entry.type === "OPEN"
                              ? "bg-blue-900/60 text-blue-200"
                              : entry.type === "CLOSE"
                              ? "bg-yellow-900/60 text-yellow-200"
                              : entry.type === "AUTO_EXIT"
                              ? "bg-purple-900/60 text-purple-200"
                              : "bg-gray-800 text-gray-400"
                          }`}
                        >
                          {entry.type}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-gray-300">{entry.pair}</td>
                      <td className="px-4 py-1.5 text-gray-400">{entry.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1 font-mono text-gray-100">{value}</p>
    </div>
  );
}
