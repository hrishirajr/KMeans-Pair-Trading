"""
AWS Lambda handler for the KMeans Pair Trading strategy.

Flow:
  1. Pull latest NSE prices via yfinance into /tmp/prices.csv
  2. Use the bundled sector_map.csv from the image
  3. Run the strategy (writes pair_summary_v2.csv, trade_log_v2.csv,
     selected_pairs_v2.csv, portfolio_returns_v2.csv to /tmp)
  4. Upload all outputs (and prices.csv) to S3 under <prefix>/data/

Triggered by EventBridge on the schedule defined in deploy.md.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import traceback
from datetime import datetime, timezone, timedelta
from pathlib import Path

import boto3
import pandas as pd
import yfinance as yf

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Lambda's only writable filesystem location
WORK_DIR = Path("/tmp/strategy")
SECTOR_MAP_BUNDLED = Path("/var/task/sector_map.csv")

# Default universe — keep in sync with sector_map.csv
DEFAULT_TICKERS = [
    "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK",
    "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM",
    "HINDALCO", "TATASTEEL", "JSWSTEEL", "COALINDIA", "VEDL",
    "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "APOLLOHOSP",
    "MARUTI", "BAJAJ-AUTO", "HEROMOTOCO", "EICHERMOT",
]

OUTPUT_FILES = [
    "prices.csv",
    "sector_map.csv",
    "selected_pairs_v2.csv",
    "pair_summary_v2.csv",
    "trade_log_v2.csv",
    "portfolio_returns_v2.csv",
]


def download_prices(start_date: str, end_date: str, tickers: list[str]) -> pd.DataFrame:
    yf_tickers = [f"{t}.NS" for t in tickers]
    logger.info("Downloading %d tickers from %s to %s", len(yf_tickers), start_date, end_date)

    data = yf.download(yf_tickers, start=start_date, end=end_date, progress=False)["Close"]
    data.columns = [c.replace(".NS", "").replace("-", "_") for c in data.columns]
    data.index.name = "Date"
    data = data.dropna(axis=1, how="all")

    missing = set(t.replace("-", "_") for t in tickers) - set(data.columns)
    if missing:
        logger.warning("Tickers with no data: %s", sorted(missing))

    return data


def prepare_workdir() -> None:
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    # Strategy expects sector_map.csv in cwd; copy from /var/task (read-only)
    if SECTOR_MAP_BUNDLED.exists():
        shutil.copy(SECTOR_MAP_BUNDLED, WORK_DIR / "sector_map.csv")
    else:
        raise FileNotFoundError(f"sector_map.csv not bundled at {SECTOR_MAP_BUNDLED}")


def run_strategy() -> None:
    """
    Import KMeansPairTrading and call main() with cwd set to WORK_DIR.
    Strategy writes its CSVs relative to cwd.
    """
    os.chdir(WORK_DIR)
    sys.path.insert(0, "/var/task")

    # Disable interactive plotting in Lambda
    os.environ["MPLBACKEND"] = "Agg"

    import KMeansPairTrading  # noqa: E402

    # Force-disable plot_examples in case the embedded config has it enabled
    original_main = KMeansPairTrading.main
    KMeansPairTrading.main = original_main  # ensure module-level main is the one we call
    KMeansPairTrading.main()


def upload_to_s3(bucket: str, prefix: str) -> list[str]:
    s3 = boto3.client("s3")
    uploaded = []
    for fname in OUTPUT_FILES:
        local = WORK_DIR / fname
        if not local.exists():
            logger.warning("Output missing, skipping: %s", fname)
            continue
        key = f"{prefix.rstrip('/')}/{fname}"
        s3.upload_file(
            str(local),
            bucket,
            key,
            ExtraArgs={
                "ContentType": "text/csv",
                "CacheControl": "public, max-age=300",
            },
        )
        uploaded.append(key)
        logger.info("Uploaded s3://%s/%s", bucket, key)
    return uploaded


def handler(event: dict, context) -> dict:
    """
    Entry point. Event may contain:
      - bucket: override S3_BUCKET env var
      - prefix: override S3_PREFIX env var (default: "data")
      - lookback_years: how many years of history to pull (default: 5)
    """
    try:
        bucket = event.get("bucket") or os.environ["S3_BUCKET"]
        prefix = event.get("prefix") or os.environ.get("S3_PREFIX", "data")
        lookback_years = int(event.get("lookback_years", 5))

        end = datetime.now(timezone.utc).date()
        start = end - timedelta(days=lookback_years * 365 + 30)

        logger.info("Run: bucket=%s prefix=%s start=%s end=%s", bucket, prefix, start, end)

        prepare_workdir()

        prices = download_prices(start.isoformat(), (end + timedelta(days=1)).isoformat(), DEFAULT_TICKERS)
        prices_path = WORK_DIR / "prices.csv"
        prices.to_csv(prices_path)
        logger.info("Saved prices: shape=%s -> %s", prices.shape, prices_path)

        run_strategy()

        keys = upload_to_s3(bucket, prefix)

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "ok": True,
                    "bucket": bucket,
                    "prefix": prefix,
                    "uploaded": keys,
                    "prices_shape": list(prices.shape),
                    "ran_at": datetime.now(timezone.utc).isoformat(),
                }
            ),
        }
    except Exception as exc:
        logger.error("Strategy run failed: %s", exc)
        logger.error(traceback.format_exc())
        return {
            "statusCode": 500,
            "body": json.dumps({"ok": False, "error": str(exc)}),
        }
