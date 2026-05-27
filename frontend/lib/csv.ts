import Papa from "papaparse";

export type CsvData = Record<string, string>[];

export function parseCsv(raw: string): CsvData {
  const result = Papa.parse(raw, { header: true, skipEmptyLines: true });
  return result.data as CsvData;
}

export async function fetchCsv(file: string): Promise<CsvData> {
  try {
    const res = await fetch(`/data/${file}`);
    if (!res.ok) return [];
    return parseCsv(await res.text());
  } catch {
    return [];
  }
}

// Compute current spread z-score using last 20 days of prices and a hedge ratio.
export function computeCurrentZ(
  stockA: string,
  stockB: string,
  hedgeRatio: number,
  prices: CsvData
): number | null {
  if (!prices?.length) return null;
  const recent = prices.slice(-20).filter((r) => r[stockA] && r[stockB]);
  if (recent.length < 10) return null;
  const spreads = recent.map(
    (r) => parseFloat(r[stockA]) - hedgeRatio * parseFloat(r[stockB])
  );
  const latest = spreads[spreads.length - 1];
  const mean = spreads.reduce((s, v) => s + v, 0) / spreads.length;
  const std = Math.sqrt(
    spreads.reduce((s, v) => s + (v - mean) ** 2, 0) / spreads.length
  );
  return std > 0 ? (latest - mean) / std : 0;
}
