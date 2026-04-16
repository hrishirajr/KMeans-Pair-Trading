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

const CSV_FILES = [
  { key: "selectedPairs", param: "selected_pairs", label: "Selected Pairs" },
  { key: "pairSummary", param: "pair_summary", label: "Pair Summary" },
  { key: "tradeLog", param: "trade_log", label: "Trade Log" },
  { key: "portfolio", param: "portfolio", label: "Portfolio Returns" },
] as const;

const ALL_FETCHES = [
  ...CSV_FILES,
  { key: "prices", param: "prices", label: "Prices" },
] as const;

const TABS = [
  ...CSV_FILES.map((f) => ({ key: f.key, label: f.label })),
  { key: "charts", label: "Charts" },
];

function parseCsv(raw: string): CsvData {
  const result = Papa.parse(raw, { header: true, skipEmptyLines: true });
  return result.data as CsvData;
}

function formatCell(value: string, col: string): string {
  if (!value || value === "") return "-";
  const num = parseFloat(value);
  if (isNaN(num)) return value;

  const lower = col.toLowerCase();
  if (
    lower.includes("return") ||
    lower.includes("cagr") ||
    lower.includes("volatility") ||
    lower.includes("drawdown") ||
    lower.includes("win_rate") ||
    lower.includes("win rate")
  ) {
    return (num * 100).toFixed(2) + "%";
  }
  if (
    lower.includes("pvalue") ||
    lower.includes("correlation") ||
    lower.includes("score") ||
    lower.includes("sharpe") ||
    lower.includes("half_life") ||
    lower.includes("hedge_ratio") ||
    lower.includes("beta")
  ) {
    return num.toFixed(4);
  }
  if (lower.includes("price")) {
    return num.toFixed(2);
  }
  return value;
}

function DataTable({ data, title }: { data: CsvData; title: string }) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-2">{title}</h2>
        <p className="text-gray-500 text-sm">
          No data available. Run the strategy to generate this output.
        </p>
      </div>
    );
  }

  const columns = Object.keys(data[0]);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-gray-200">{title}</h2>
        <p className="text-gray-500 text-xs mt-1">{data.length} rows</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-gray-800/50 transition-colors">
                {columns.map((col) => {
                  const raw = row[col] ?? "";
                  const formatted = formatCell(raw, col);
                  const num = parseFloat(raw);
                  const isReturn =
                    col.toLowerCase().includes("return") ||
                    col.toLowerCase().includes("sharpe") ||
                    col.toLowerCase().includes("cagr");
                  let colorClass = "text-gray-300";
                  if (isReturn && !isNaN(num)) {
                    colorClass =
                      num > 0
                        ? "text-green-400"
                        : num < 0
                        ? "text-red-400"
                        : "text-gray-300";
                  }
                  return (
                    <td
                      key={col}
                      className={`px-4 py-2.5 whitespace-nowrap font-mono text-xs ${colorClass}`}
                    >
                      {formatted}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Portfolio Equity Curve ──
function EquityChart({ portfolio }: { portfolio: CsvData }) {
  if (!portfolio || portfolio.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-2">
          Portfolio Equity Curve
        </h2>
        <p className="text-gray-500 text-sm">
          No portfolio data. Run the strategy first.
        </p>
      </div>
    );
  }

  const chartData = portfolio
    .filter((row) => row["portfolio_equity"])
    .map((row) => {
      const dateKey = Object.keys(row)[0]; // first column is the date index
      return {
        date: row[dateKey]?.slice(0, 10) ?? "",
        equity: parseFloat(row["portfolio_equity"]) || 1,
      };
    });

  const minEquity = Math.min(...chartData.map((d) => d.equity));
  const maxEquity = Math.max(...chartData.map((d) => d.equity));
  const yMin = Math.floor(minEquity * 100) / 100 - 0.02;
  const yMax = Math.ceil(maxEquity * 100) / 100 + 0.02;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-200 mb-1">
        Portfolio Equity Curve
      </h2>
      <p className="text-gray-500 text-xs mb-4">
        Combined equity across all traded pairs
      </p>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="date"
            tick={{ fill: "#9ca3af", fontSize: 10 }}
            interval="preserveStartEnd"
            minTickGap={60}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#9ca3af" }}
            formatter={(v: number) => [v.toFixed(4), "Equity"]}
          />
          <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#3b82f6"
            fill="url(#eqGrad)"
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Pair Price Comparison Charts ──
function PairPriceCharts({
  selectedPairs,
  prices,
}: {
  selectedPairs: CsvData;
  prices: CsvData;
}) {
  if (
    !selectedPairs ||
    selectedPairs.length === 0 ||
    !prices ||
    prices.length === 0
  ) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-2">
          Pair Price Charts
        </h2>
        <p className="text-gray-500 text-sm">
          No pair or price data available.
        </p>
      </div>
    );
  }

  // Get unique pairs
  const seen = new Set<string>();
  const uniquePairs: { a: string; b: string; sector: string }[] = [];
  for (const row of selectedPairs) {
    const key = `${row.stock_a}_${row.stock_b}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePairs.push({
        a: row.stock_a,
        b: row.stock_b,
        sector: row.sector,
      });
    }
  }

  const dateKey = Object.keys(prices[0])[0];
  const COLORS = ["#3b82f6", "#f59e0b"];

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

        if (chartData.length === 0) return null;

        // Normalize to base 100 for comparison
        const baseA = chartData[0][a] as number;
        const baseB = chartData[0][b] as number;
        const normalized = chartData.map((d) => ({
          date: d.date,
          [a]: baseA ? (((d[a] as number) / baseA) * 100) : 100,
          [b]: baseB ? (((d[b] as number) / baseB) * 100) : 100,
        }));

        return (
          <div
            key={`${a}_${b}`}
            className="bg-gray-900 border border-gray-700 rounded-lg p-6"
          >
            <h2 className="text-lg font-semibold text-gray-200 mb-1">
              {a} vs {b}
            </h2>
            <p className="text-gray-500 text-xs mb-4">
              Sector: {sector} &middot; Normalized to 100
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={normalized}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={60}
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "1px solid #374151",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#9ca3af" }}
                  formatter={(v: number, name: string) => [
                    v.toFixed(2),
                    name,
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "#d1d5db" }}
                />
                <Line
                  type="monotone"
                  dataKey={a}
                  stroke={COLORS[0]}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey={b}
                  stroke={COLORS[1]}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

// ── Charts Tab ──
function ChartsTab({ data }: { data: DataState }) {
  return (
    <div className="space-y-6">
      <EquityChart portfolio={data.portfolio} />
      <PairPriceCharts
        selectedPairs={data.selectedPairs}
        prices={data.prices}
      />
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
  const [activeTab, setActiveTab] = useState<string>("selectedPairs");

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const results: Partial<DataState> = {};

      await Promise.all(
        ALL_FETCHES.map(async ({ key, param }) => {
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

  const activeCsvTab = CSV_FILES.find((f) => f.key === activeTab);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold tracking-tight">
            KMeans Pair Trading
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Strategy Report Console
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {CSV_FILES.map(({ key, label }) => {
            const rows = data[key as keyof DataState]?.length ?? 0;
            return (
              <div
                key={key}
                className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3"
              >
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  {label}
                </p>
                <p className="text-2xl font-bold mt-1">
                  {loading ? "..." : rows}
                </p>
                <p className="text-xs text-gray-600">rows</p>
              </div>
            );
          })}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 border border-gray-700 rounded-lg p-1 overflow-x-auto">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === key
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500">Loading CSV data...</div>
          </div>
        ) : activeTab === "charts" ? (
          <ChartsTab data={data} />
        ) : (
          <DataTable
            data={data[activeTab as keyof DataState]}
            title={activeCsvTab?.label ?? ""}
          />
        )}
      </main>
    </div>
  );
}
