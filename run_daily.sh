#!/bin/bash
set -e
cd /Users/shreyatandon/stocks/KMeans-Pair-Trading
source myenv/bin/activate
echo "=== Run started: $(date) ==="
python3 download_data.py
python3 KMeansPairTrading.py
cp pair_summary_v2.csv trade_log_v2.csv selected_pairs_v2.csv portfolio_returns_v2.csv prices.csv sector_map.csv frontend/public/data/
echo "=== Run finished: $(date) ==="
