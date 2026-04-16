"""
Download NSE Nifty 50 price data and generate sector_map.csv
for the KMeans Pair Trading strategy.

Usage:
    pip install yfinance
    python3 download_data.py
"""

import yfinance as yf
import pandas as pd

# Stock-to-sector mapping (NSE symbols with .NS suffix for yfinance)
STOCK_SECTORS = {
    # BANKING
    "HDFCBANK": "BANKING",
    "ICICIBANK": "BANKING",
    "SBIN": "BANKING",
    "KOTAKBANK": "BANKING",
    "AXISBANK": "BANKING",
    # IT
    "TCS": "IT",
    "INFY": "IT",
    "HCLTECH": "IT",
    "WIPRO": "IT",
    "TECHM": "IT",
    # METALS
    "HINDALCO": "METALS",
    "TATASTEEL": "METALS",
    "JSWSTEEL": "METALS",
    "COALINDIA": "METALS",
    "VEDL": "METALS",
    # PHARMA
    "SUNPHARMA": "PHARMA",
    "DRREDDY": "PHARMA",
    "CIPLA": "PHARMA",
    "DIVISLAB": "PHARMA",
    "APOLLOHOSP": "PHARMA",
    # AUTO
    "MARUTI": "AUTO",
    "TATAMOTORS": "AUTO",
    "BAJAJ-AUTO": "AUTO",
    "HEROMOTOCO": "AUTO",
    "EICHERMOT": "AUTO",
}

START_DATE = "2021-01-01"
END_DATE = "2026-04-16"


def main():
    tickers_nse = [f"{stock}.NS" for stock in STOCK_SECTORS]

    print(f"Downloading {len(tickers_nse)} stocks from {START_DATE} to {END_DATE}...")
    data = yf.download(tickers_nse, start=START_DATE, end=END_DATE)["Close"]

    # Clean column names: remove .NS suffix, replace - with _
    data.columns = [c.replace(".NS", "").replace("-", "_") for c in data.columns]
    data.index.name = "Date"

    # Drop stocks that have no data
    before = data.shape[1]
    data = data.dropna(axis=1, how="all")
    after = data.shape[1]
    if before != after:
        print(f"Warning: dropped {before - after} stocks with no data")

    data.to_csv("prices.csv")
    print(f"\nprices.csv saved -> {data.shape[0]} trading days x {data.shape[1]} stocks")
    print(f"Date range: {data.index[0].date()} to {data.index[-1].date()}")

    # Generate sector_map.csv (matching cleaned column names)
    sector_rows = []
    for stock, sector in STOCK_SECTORS.items():
        clean_name = stock.replace("-", "_")
        if clean_name in data.columns:
            sector_rows.append({"stock": clean_name, "sector": sector})
        else:
            print(f"Warning: {clean_name} not found in downloaded data, skipping")

    sector_df = pd.DataFrame(sector_rows)
    sector_df.to_csv("sector_map.csv", index=False)
    print(f"\nsector_map.csv saved -> {len(sector_df)} stocks across {sector_df['sector'].nunique()} sectors")
    print(f"\nSectors:\n{sector_df.groupby('sector')['stock'].apply(list).to_string()}")


if __name__ == "__main__":
    main()
