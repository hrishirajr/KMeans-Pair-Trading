"""
Run the walk-forward engine under two config variants on the same
price history and report comparable long-term metrics.

Variants:
  A — Original : k=5, corr 0.60, coint 0.10
  B — Current  : k=7, corr 0.55, coint 0.10
"""

import pandas as pd
import numpy as np

from KMeansPairTrading import (
    StrategyConfig,
    load_prices,
    load_sector_map,
    run_walk_forward_v2,
    compute_performance_metrics,
)


def build_cfg(n_clusters, min_corr, max_coint_p):
    return StrategyConfig(
        price_csv_path="prices.csv",
        sector_csv_path="sector_map.csv",
        train_window=252,
        test_window=126,
        step_size=63,
        n_clusters=n_clusters,
        top_pairs_per_cluster=3,
        same_sector_only=True,
        min_correlation=min_corr,
        max_cointegration_pvalue=max_coint_p,
        max_adf_pvalue=0.15,
        min_half_life=2,
        max_half_life=60,
        z_window=20,
        z_entry_min=1.80,
        z_entry_max=2.10,
        z_exit=0.5,
        z_stop=3.5,
        max_holding_period=20,
        rolling_beta_window=30,
        transaction_cost_per_leg=0.0005,
        random_state=42,
        plot_examples=False,
    )


def run_one(label, cfg, prices, sector_map):
    summary_df, trade_log_df, _, _, port_df = run_walk_forward_v2(prices, sector_map, cfg)

    if port_df.empty or "portfolio_return" not in port_df.columns:
        return {"label": label, "windows": 0, "trades": 0, "metrics": {}, "equity": pd.Series(dtype=float)}

    ret = port_df["portfolio_return"].dropna()
    metrics = compute_performance_metrics(ret)
    pair_sharpes = summary_df["Sharpe"].dropna() if not summary_df.empty else pd.Series(dtype=float)
    pair_returns = summary_df["Total Return"].dropna() if not summary_df.empty else pd.Series(dtype=float)

    return {
        "label": label,
        "windows": len(summary_df),
        "unique_pairs": summary_df[["stock_a", "stock_b"]].drop_duplicates().shape[0] if not summary_df.empty else 0,
        "trades": len(trade_log_df),
        "metrics": metrics,
        "median_pair_sharpe": float(pair_sharpes.median()) if len(pair_sharpes) else np.nan,
        "pct_winning_windows": float((pair_sharpes > 0).mean()) if len(pair_sharpes) else np.nan,
        "avg_pair_return": float(pair_returns.mean()) if len(pair_returns) else np.nan,
        "equity": port_df["portfolio_equity"].copy(),
    }


def fmt_pct(x):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "n/a"
    return f"{x*100:>+7.2f}%"


def fmt_num(x):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "    n/a"
    return f"{x:>+7.3f}"


def main():
    prices = load_prices("prices.csv")
    sector_map = load_sector_map("sector_map.csv")
    common = sorted(set(prices.columns).intersection(set(sector_map["stock"])))
    prices = prices[common].copy()
    sector_map = sector_map[sector_map["stock"].isin(common)].copy()

    print(f"Universe: {len(common)} stocks | Date range: {prices.index[0].date()} → {prices.index[-1].date()} | Trading days: {len(prices)}\n")

    variants = [
        ("A — Original (k=5, corr≥0.60, coint p≤0.10)", build_cfg(n_clusters=5, min_corr=0.60, max_coint_p=0.10)),
        ("B — Current  (k=7, corr≥0.55, coint p≤0.10)", build_cfg(n_clusters=7, min_corr=0.55, max_coint_p=0.10)),
    ]

    results = []
    for label, cfg in variants:
        print(f"Running: {label}")
        r = run_one(label, cfg, prices, sector_map)
        results.append(r)

    # ── Long-term comparison table ──
    print("\n" + "=" * 90)
    print(f"{'Metric':<32}{'A — Original':>28}{'B — Current':>28}")
    print(f"{'':<32}{'k=5 / 0.60 / 0.10':>28}{'k=7 / 0.55 / 0.10':>28}")
    print("-" * 90)

    def metric_row(name, key, formatter):
        a = formatter(results[0]["metrics"].get(key))
        b = formatter(results[1]["metrics"].get(key))
        print(f"{name:<32}{a:>28}{b:>28}")

    metric_row("Total Return",          "Total Return",          fmt_pct)
    metric_row("CAGR",                  "CAGR",                  fmt_pct)
    metric_row("Annualized Volatility", "Annualized Volatility", fmt_pct)
    metric_row("Sharpe",                "Sharpe",                fmt_num)
    metric_row("Max Drawdown",          "Max Drawdown",          fmt_pct)
    metric_row("Daily Win Rate",        "Win Rate",              fmt_pct)
    print("-" * 90)
    print(f"{'Backtest windows':<32}{results[0]['windows']:>28}{results[1]['windows']:>28}")
    print(f"{'Unique pairs selected':<32}{results[0]['unique_pairs']:>28}{results[1]['unique_pairs']:>28}")
    print(f"{'Total trades':<32}{results[0]['trades']:>28}{results[1]['trades']:>28}")
    print(f"{'Median pair-window Sharpe':<32}{fmt_num(results[0]['median_pair_sharpe']):>28}{fmt_num(results[1]['median_pair_sharpe']):>28}")
    print(f"{'Avg pair-window Total Ret':<32}{fmt_pct(results[0]['avg_pair_return']):>28}{fmt_pct(results[1]['avg_pair_return']):>28}")
    print(f"{'% pair-windows w/ Sharpe>0':<32}{fmt_pct(results[0]['pct_winning_windows']):>28}{fmt_pct(results[1]['pct_winning_windows']):>28}")
    print("=" * 90)

    # ── Equity curve year-end checkpoints ──
    print("\nPortfolio equity at year-end (start = 1.0000):")
    all_idx = sorted(set().union(*[set(r["equity"].index) for r in results]))
    aligned = pd.DataFrame({"A": results[0]["equity"], "B": results[1]["equity"]}, index=all_idx).ffill()
    for y in sorted(set([d.year for d in aligned.index])):
        slice_y = aligned[aligned.index.year == y]
        if slice_y.empty:
            continue
        last = slice_y.iloc[-1]
        date = slice_y.index[-1].date()
        a_str = f"{last['A']:.4f}" if not np.isnan(last['A']) else "  n/a "
        b_str = f"{last['B']:.4f}" if not np.isnan(last['B']) else "  n/a "
        delta = (last['B'] - last['A']) * 100 if not (np.isnan(last['A']) or np.isnan(last['B'])) else np.nan
        delta_str = f"{delta:+.2f} pts" if not np.isnan(delta) else ""
        print(f"  {date}  |  A: {a_str}   B: {b_str}   ({delta_str})")


if __name__ == "__main__":
    main()
