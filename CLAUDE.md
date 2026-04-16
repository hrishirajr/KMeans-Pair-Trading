# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KMeans Pair Trading framework for NSE Nifty 50 equities. Uses KMeans clustering on stock features to identify cointegrated pairs, then trades mean-reversion of their spread via z-score signals in a walk-forward backtest.

## Commands

```bash
# Run the strategy (requires prices.csv and sector_map.csv in project root)
python3 KMeansPairTrading.py

# Set up environment
python3 -m venv myenv
source myenv/bin/activate
pip install numpy pandas matplotlib statsmodels scikit-learn
```

There is no test suite, linter, or build system.

## Input Data

The strategy requires two CSV files (not checked into the repo):
- **`prices.csv`**: Date-indexed price matrix. Rows = trading dates, columns = stock tickers.
- **`sector_map.csv`**: Two columns: `stock` and `sector`. Used for sector-aware pair filtering.

Only stocks present in both files are used.

## Architecture

Everything lives in a single file `KMeansPairTrading.py` organized into these sections:

1. **Config** (`StrategyConfig` dataclass) - All tunable parameters: window sizes, clustering, statistical thresholds, z-score entry/exit/stop levels, transaction costs.
2. **Loaders** - `load_prices()`, `load_sector_map()` read and clean CSVs.
3. **Feature Engineering** - `compute_stock_features()` builds 12 momentum/volatility/drawdown features per stock. `cluster_stocks()` runs KMeans on standardized features.
4. **Statistics Helpers** - OLS hedge ratio (static and rolling), spread computation, ADF test, half-life estimation, z-score calculation.
5. **Pair Selection** - Within each cluster (optionally same-sector only), pairs are filtered by correlation, cointegration p-value, ADF p-value, and half-life. Ranked by `score_pair()` (lower is better). Top N per cluster are kept.
6. **Backtest** (`backtest_pair_v2`) - Simulates trading a single pair with rolling hedge ratio. Tracks positions, entries/exits (mean-reversion, z-stop, time-stop), and computes equity curve net of transaction costs.
7. **Portfolio** - Equal-weights all pair return streams into a portfolio equity curve.
8. **Walk-Forward Engine** (`run_walk_forward_v2`) - Slides train/test windows forward by `step_size` days. Each iteration: re-clusters, re-selects pairs, backtests on the out-of-sample window.

## Output

The strategy writes four CSV files to the project root: `pair_summary_v2.csv`, `trade_log_v2.csv`, `selected_pairs_v2.csv`, `portfolio_returns_v2.csv`. It also displays matplotlib plots of example pair spreads/z-scores and the portfolio equity curve.
