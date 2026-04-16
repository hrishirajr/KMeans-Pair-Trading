import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");

const ALLOWED_FILES: Record<string, string> = {
  selected_pairs: "selected_pairs_v2.csv",
  pair_summary: "pair_summary_v2.csv",
  trade_log: "trade_log_v2.csv",
  portfolio: "portfolio_returns_v2.csv",
  prices: "prices.csv",
  sector_map: "sector_map.csv",
};

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get("file");

  if (!file || !(file in ALLOWED_FILES)) {
    return NextResponse.json(
      {
        error: `Invalid file. Use one of: ${Object.keys(ALLOWED_FILES).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const filePath = path.join(PROJECT_ROOT, ALLOWED_FILES[file]);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: `${ALLOWED_FILES[file]} not found. Run the strategy first.`, data: null },
      { status: 404 }
    );
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return NextResponse.json({ file: ALLOWED_FILES[file], data: content });
}
