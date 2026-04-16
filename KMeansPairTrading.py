"""
Version 2: KMeans + Cointegration + Z-Score Pair Trading Framework

Enhancements over V1:
- Sector-aware pair filtering
- Rolling hedge ratio
- Pair ranking
- Detailed trade log
- Spread / Z-score plots
- Cleaner walk-forward framework

"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from itertools import combinations
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import statsmodels.api as sm

from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from statsmodels.tsa.stattools import coint, adfuller

warnings.filterwarnings("ignore")


# ============================================================
# Config
# ============================================================

@dataclass
class StrategyConfig:
    price_csv_path: str = "prices.csv"
    sector_csv_path: str = "sector_map.csv"

    train_window: int = 252
    test_window: int = 63
    step_size: int = 63

    n_clusters: int = 5
    top_pairs_per_cluster: int = 3
    same_sector_only: bool = True

    min_correlation: float = 0.70
    max_cointegration_pvalue: float = 0.05
    max_adf_pvalue: float = 0.10

    min_half_life: int = 2
    max_half_life: int = 60

    z_window: int = 20
    z_entry: float = 2.0
    z_exit: float = 0.5
    z_stop: float = 3.5
    max_holding_period: int = 20

    rolling_beta_window: int = 60
    transaction_cost_per_leg: float = 0.0005

    random_state: int = 42
    min_history_required: int = 120

    plot_examples: bool = True
    example_plot_count: int = 3


# ============================================================
# Loaders
# ============================================================

def load_prices(csv_path: str) -> pd.DataFrame:
    prices = pd.read_csv(csv_path, index_col=0, parse_dates=True)
    prices = prices.sort_index()
    prices = prices.replace([np.inf, -np.inf], np.nan)
    prices = prices.dropna(axis=1, how="any")
    prices = prices.dropna()
    return prices


def load_sector_map(csv_path: str) -> pd.DataFrame:
    sector_map = pd.read_csv(csv_path)
    sector_map.columns = [c.strip().lower() for c in sector_map.columns]
    sector_map["stock"] = sector_map["stock"].astype(str).str.strip()
    sector_map["sector"] = sector_map["sector"].astype(str).str.strip()
    return sector_map


# ============================================================
# Feature Engineering
# ============================================================

def compute_stock_features(train_prices: pd.DataFrame) -> pd.DataFrame:
    returns = train_prices.pct_change().dropna()
    rows = []

    for stock in train_prices.columns:
        px = train_prices[stock].dropna()
        ret = returns[stock].dropna()

        if len(px) < 80 or len(ret) < 80:
            continue

        row = {
            "stock": stock,
            "ret_20": px.pct_change(20).iloc[-1],
            "ret_60": px.pct_change(60).iloc[-1] if len(px) >= 61 else np.nan,
            "vol_20": ret.tail(20).std(),
            "vol_60": ret.tail(60).std(),
            "mean_ret_20": ret.tail(20).mean(),
            "mean_ret_60": ret.tail(60).mean(),
            "skew_60": ret.tail(60).skew(),
            "kurt_60": ret.tail(60).kurt(),
            "drawdown_60": ((px.tail(60) / px.tail(60).cummax()) - 1).min(),
            "price_vs_ma20": (px.iloc[-1] / px.tail(20).mean()) - 1,
            "price_vs_ma60": (px.iloc[-1] / px.tail(60).mean()) - 1,
        }
        rows.append(row)

    features = pd.DataFrame(rows).set_index("stock")
    features = features.replace([np.inf, -np.inf], np.nan).dropna()
    return features


def cluster_stocks(features: pd.DataFrame, n_clusters: int, random_state: int) -> pd.DataFrame:
    scaler = StandardScaler()
    X = scaler.fit_transform(features.values)

    model = KMeans(n_clusters=n_clusters, random_state=random_state, n_init=20)
    labels = model.fit_predict(X)

    out = features.copy()
    out["cluster"] = labels
    return out


# ============================================================
# Statistics Helpers
# ============================================================

def estimate_static_beta(y: pd.Series, x: pd.Series) -> float:
    x_const = sm.add_constant(x)
    model = sm.OLS(y, x_const).fit()
    return float(model.params.iloc[1])


def rolling_hedge_ratio(y: pd.Series, x: pd.Series, window: int) -> pd.Series:
    """
    Rolling OLS hedge ratio.
    beta_t is estimated using past window observations only.
    """
    beta_values = pd.Series(index=y.index, dtype=float)

    for i in range(window, len(y) + 1):
        y_window = y.iloc[i - window:i]
        x_window = x.iloc[i - window:i]
        x_const = sm.add_constant(x_window)
        model = sm.OLS(y_window, x_const).fit()
        beta_values.iloc[i - 1] = model.params.iloc[1]

    beta_values = beta_values.ffill()
    return beta_values


def compute_spread(y: pd.Series, x: pd.Series, beta: pd.Series | float) -> pd.Series:
    return y - beta * x


def adf_pvalue(series: pd.Series) -> float:
    series = series.dropna()
    if len(series) < 20:
        return 1.0
    try:
        return adfuller(series)[1]
    except Exception:
        return 1.0


def estimate_half_life(spread: pd.Series) -> Optional[float]:
    spread = spread.dropna()
    if len(spread) < 30:
        return None

    lagged = spread.shift(1)
    delta = spread.diff()

    reg_df = pd.concat([lagged, delta], axis=1).dropna()
    reg_df.columns = ["lagged", "delta"]

    if len(reg_df) < 20:
        return None

    X = sm.add_constant(reg_df["lagged"])
    model = sm.OLS(reg_df["delta"], X).fit()

    lam = model.params["lagged"]
    if lam >= 0:
        return None

    hl = -np.log(2) / lam
    if np.isinf(hl) or np.isnan(hl):
        return None

    return float(hl)


def compute_zscore(spread: pd.Series, window: int) -> pd.Series:
    mean = spread.rolling(window).mean()
    std = spread.rolling(window).std()
    return (spread - mean) / std


# ============================================================
# Pair Selection
# ============================================================

def attach_sector_info(clustered: pd.DataFrame, sector_map: pd.DataFrame) -> pd.DataFrame:
    merged = clustered.reset_index().rename(columns={"index": "stock"})
    merged = merged.merge(sector_map, on="stock", how="left")
    merged["sector"] = merged["sector"].fillna("UNKNOWN")
    return merged.set_index("stock")


def score_pair(
    corr: float,
    coint_p: float,
    adf_p: float,
    half_life: float
) -> float:
    """
    Lower score is better.
    """
    return (
        coint_p * 10
        + adf_p * 3
        - corr
        + abs(half_life - 10) * 0.02
    )


def find_candidate_pairs(
    train_prices: pd.DataFrame,
    clustered_with_sector: pd.DataFrame,
    config: StrategyConfig,
) -> pd.DataFrame:
    candidates = []

    for cluster_id in sorted(clustered_with_sector["cluster"].unique()):
        cluster_df = clustered_with_sector[clustered_with_sector["cluster"] == cluster_id]

        if len(cluster_df) < 2:
            continue

        stocks = cluster_df.index.tolist()

        for a, b in combinations(stocks, 2):
            sector_a = cluster_df.loc[a, "sector"]
            sector_b = cluster_df.loc[b, "sector"]

            if config.same_sector_only and sector_a != sector_b:
                continue

            pair_px = train_prices[[a, b]].dropna()
            if len(pair_px) < config.min_history_required:
                continue

            y = pair_px[a]
            x = pair_px[b]

            corr = y.pct_change().corr(x.pct_change())
            if pd.isna(corr) or corr < config.min_correlation:
                continue

            try:
                _, coint_p, _ = coint(y, x)
            except Exception:
                continue

            if coint_p > config.max_cointegration_pvalue:
                continue

            beta = estimate_static_beta(y, x)
            spread = compute_spread(y, x, beta)
            adf_p = adf_pvalue(spread)
            if adf_p > config.max_adf_pvalue:
                continue

            hl = estimate_half_life(spread)
            if hl is None:
                continue

            if not (config.min_half_life <= hl <= config.max_half_life):
                continue

            pair_score = score_pair(corr, coint_p, adf_p, hl)

            candidates.append({
                "stock_a": a,
                "stock_b": b,
                "sector": sector_a,
                "cluster": cluster_id,
                "correlation": corr,
                "cointegration_pvalue": coint_p,
                "spread_adf_pvalue": adf_p,
                "hedge_ratio": beta,
                "half_life": hl,
                "pair_score": pair_score,
            })

    if not candidates:
        return pd.DataFrame()

    candidate_df = pd.DataFrame(candidates)
    candidate_df = candidate_df.sort_values(["cluster", "pair_score"])

    # Keep top N per cluster
    final_rows = []
    for cluster_id, group in candidate_df.groupby("cluster"):
        final_rows.append(group.head(config.top_pairs_per_cluster))

    out = pd.concat(final_rows, axis=0).reset_index(drop=True)
    return out


# ============================================================
# Backtest
# ============================================================

def backtest_pair_v2(
    test_prices: pd.DataFrame,
    stock_a: str,
    stock_b: str,
    config: StrategyConfig,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Rolling-beta pair trading.
    Returns:
    - timeseries df
    - trade log df
    """
    df = test_prices[[stock_a, stock_b]].dropna().copy()
    if len(df) < max(config.z_window, config.rolling_beta_window) + 5:
        return pd.DataFrame(), pd.DataFrame()

    y = df[stock_a]
    x = df[stock_b]

    df["beta"] = rolling_hedge_ratio(y, x, config.rolling_beta_window)
    df["spread"] = compute_spread(y, x, df["beta"])
    df["zscore"] = compute_zscore(df["spread"], config.z_window)

    df["ret_a"] = y.pct_change().fillna(0.0)
    df["ret_b"] = x.pct_change().fillna(0.0)

    position = 0
    holding_days = 0
    entry_date = None
    entry_z = None
    entry_spread = None
    entry_a = None
    entry_b = None

    positions = []
    signals = []
    trade_log = []

    for i in range(len(df)):
        z = df["zscore"].iloc[i]
        dt = df.index[i]

        signal = ""
        if pd.isna(z):
            positions.append(0)
            signals.append(signal)
            continue

        if position == 0:
            holding_days = 0

            if z < -config.z_entry:
                position = 1   # long spread
                holding_days = 1
                entry_date = dt
                entry_z = z
                entry_spread = df["spread"].iloc[i]
                entry_a = df[stock_a].iloc[i]
                entry_b = df[stock_b].iloc[i]
                signal = "ENTER_LONG_SPREAD"

            elif z > config.z_entry:
                position = -1  # short spread
                holding_days = 1
                entry_date = dt
                entry_z = z
                entry_spread = df["spread"].iloc[i]
                entry_a = df[stock_a].iloc[i]
                entry_b = df[stock_b].iloc[i]
                signal = "ENTER_SHORT_SPREAD"

        else:
            holding_days += 1

            exit_reason = None

            if abs(z) < config.z_exit:
                exit_reason = "MEAN_REVERSION_EXIT"
            elif abs(z) > config.z_stop:
                exit_reason = "ZSCORE_STOP"
            elif holding_days >= config.max_holding_period:
                exit_reason = "TIME_STOP"

            if exit_reason is not None:
                exit_a = df[stock_a].iloc[i]
                exit_b = df[stock_b].iloc[i]
                exit_spread = df["spread"].iloc[i]

                if position == 1:
                    gross_trade_return = ((exit_a / entry_a) - 1) - df["beta"].iloc[i] * ((exit_b / entry_b) - 1)
                    direction = "LONG_SPREAD"
                else:
                    gross_trade_return = -((exit_a / entry_a) - 1) + df["beta"].iloc[i] * ((exit_b / entry_b) - 1)
                    direction = "SHORT_SPREAD"

                approx_cost = 4 * config.transaction_cost_per_leg  # enter two legs + exit two legs
                net_trade_return = gross_trade_return - approx_cost

                trade_log.append({
                    "entry_date": entry_date,
                    "exit_date": dt,
                    "stock_a": stock_a,
                    "stock_b": stock_b,
                    "direction": direction,
                    "entry_z": entry_z,
                    "exit_z": z,
                    "entry_spread": entry_spread,
                    "exit_spread": exit_spread,
                    "holding_days": holding_days,
                    "entry_price_a": entry_a,
                    "entry_price_b": entry_b,
                    "exit_price_a": exit_a,
                    "exit_price_b": exit_b,
                    "gross_trade_return": gross_trade_return,
                    "net_trade_return": net_trade_return,
                    "exit_reason": exit_reason,
                })

                position = 0
                holding_days = 0
                entry_date = None
                entry_z = None
                entry_spread = None
                entry_a = None
                entry_b = None
                signal = exit_reason

        positions.append(position)
        signals.append(signal)

    df["position"] = positions
    df["signal"] = signals
    df["position_shifted"] = df["position"].shift(1).fillna(0)

    df["gross_return"] = df["position_shifted"] * (df["ret_a"] - df["beta"] * df["ret_b"])
    df["turnover"] = df["position"].diff().abs().fillna(abs(df["position"]))
    df["cost"] = df["turnover"] * (2 * config.transaction_cost_per_leg)
    df["net_return"] = df["gross_return"] - df["cost"]
    df["equity_curve"] = (1 + df["net_return"]).cumprod()

    trade_log_df = pd.DataFrame(trade_log)
    return df, trade_log_df


# ============================================================
# Portfolio + Metrics
# ============================================================

def compute_performance_metrics(returns: pd.Series) -> Dict[str, float]:
    returns = returns.dropna()
    if len(returns) == 0:
        return {}

    equity = (1 + returns).cumprod()
    total_return = equity.iloc[-1] - 1
    cagr = equity.iloc[-1] ** (252 / len(returns)) - 1 if len(returns) > 0 else np.nan
    vol = returns.std() * np.sqrt(252)
    sharpe = (returns.mean() / returns.std()) * np.sqrt(252) if returns.std() != 0 else np.nan

    running_max = equity.cummax()
    dd = equity / running_max - 1
    max_dd = dd.min()
    win_rate = (returns > 0).mean()

    return {
        "Total Return": total_return,
        "CAGR": cagr,
        "Annualized Volatility": vol,
        "Sharpe": sharpe,
        "Max Drawdown": max_dd,
        "Win Rate": win_rate,
    }


def aggregate_portfolio(pair_result_dict: Dict[str, pd.DataFrame]) -> pd.DataFrame:
    if not pair_result_dict:
        return pd.DataFrame()

    series_list = []
    for name, df in pair_result_dict.items():
        if df.empty:
            continue
        series_list.append(df["net_return"].rename(name))

    if not series_list:
        return pd.DataFrame()

    combined = pd.concat(series_list, axis=1).fillna(0.0)
    combined["portfolio_return"] = combined.mean(axis=1)
    combined["portfolio_equity"] = (1 + combined["portfolio_return"]).cumprod()
    return combined


# ============================================================
# Plotting
# ============================================================

def plot_pair_example(df: pd.DataFrame, stock_a: str, stock_b: str, title_suffix: str = "") -> None:
    if df.empty:
        return

    fig, axes = plt.subplots(3, 1, figsize=(12, 9), sharex=True)

    axes[0].plot(df.index, df[stock_a], label=stock_a)
    axes[0].plot(df.index, df[stock_b], label=stock_b)
    axes[0].set_title(f"{stock_a} vs {stock_b} {title_suffix}")
    axes[0].legend()
    axes[0].grid(True)

    axes[1].plot(df.index, df["spread"], label="Spread")
    axes[1].set_title("Spread")
    axes[1].legend()
    axes[1].grid(True)

    axes[2].plot(df.index, df["zscore"], label="Z-score")
    axes[2].axhline(2.0, linestyle="--")
    axes[2].axhline(-2.0, linestyle="--")
    axes[2].axhline(0.5, linestyle=":")
    axes[2].axhline(-0.5, linestyle=":")
    axes[2].axhline(0.0)
    axes[2].set_title("Z-score")
    axes[2].legend()
    axes[2].grid(True)

    plt.tight_layout()
    plt.show()


def plot_portfolio_equity(portfolio_df: pd.DataFrame) -> None:
    if portfolio_df.empty:
        return
    plt.figure(figsize=(12, 5))
    plt.plot(portfolio_df.index, portfolio_df["portfolio_equity"])
    plt.title("Portfolio Equity Curve")
    plt.xlabel("Date")
    plt.ylabel("Equity")
    plt.grid(True)
    plt.tight_layout()
    plt.show()


# ============================================================
# Walk-Forward Engine
# ============================================================

def run_walk_forward_v2(
    prices: pd.DataFrame,
    sector_map: pd.DataFrame,
    config: StrategyConfig,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, Dict[str, pd.DataFrame]]:
    pair_results = {}
    all_trade_logs = []
    summary_rows = []
    pair_selection_rows = []

    dates = prices.index
    start_idx = config.train_window
    iteration = 0

    while start_idx + config.test_window <= len(dates):
        iteration += 1

        train_prices = prices.iloc[start_idx - config.train_window:start_idx]
        test_prices = prices.iloc[start_idx:start_idx + config.test_window]

        features = compute_stock_features(train_prices)
        if len(features) < config.n_clusters:
            start_idx += config.step_size
            continue

        clustered = cluster_stocks(features, config.n_clusters, config.random_state)
        clustered = attach_sector_info(clustered, sector_map)

        candidate_pairs = find_candidate_pairs(train_prices, clustered, config)

        print(
            f"Iteration {iteration} | "
            f"Train: {train_prices.index[0].date()} -> {train_prices.index[-1].date()} | "
            f"Test: {test_prices.index[0].date()} -> {test_prices.index[-1].date()} | "
            f"Pairs selected: {len(candidate_pairs)}"
        )

        if candidate_pairs.empty:
            start_idx += config.step_size
            continue

        for _, pair in candidate_pairs.iterrows():
            a = pair["stock_a"]
            b = pair["stock_b"]

            pair_selection_rows.append({
                "test_start": test_prices.index[0],
                "test_end": test_prices.index[-1],
                **pair.to_dict()
            })

            bt_df, trade_log_df = backtest_pair_v2(
                test_prices=test_prices,
                stock_a=a,
                stock_b=b,
                config=config,
            )

            if bt_df.empty:
                continue

            pair_key = f"{test_prices.index[0].date()}__{a}__{b}"
            pair_results[pair_key] = bt_df

            metrics = compute_performance_metrics(bt_df["net_return"])
            summary_rows.append({
                "test_start": test_prices.index[0],
                "test_end": test_prices.index[-1],
                "stock_a": a,
                "stock_b": b,
                "sector": pair["sector"],
                "cluster": pair["cluster"],
                "correlation": pair["correlation"],
                "cointegration_pvalue": pair["cointegration_pvalue"],
                "spread_adf_pvalue": pair["spread_adf_pvalue"],
                "half_life": pair["half_life"],
                "pair_score": pair["pair_score"],
                **metrics
            })

            if not trade_log_df.empty:
                trade_log_df["test_start"] = test_prices.index[0]
                trade_log_df["test_end"] = test_prices.index[-1]
                all_trade_logs.append(trade_log_df)

        start_idx += config.step_size

    summary_df = pd.DataFrame(summary_rows)
    trade_log_df = pd.concat(all_trade_logs, ignore_index=True) if all_trade_logs else pd.DataFrame()
    pair_selection_df = pd.DataFrame(pair_selection_rows)
    portfolio_df = aggregate_portfolio(pair_results)

    return summary_df, trade_log_df, pair_selection_df, pair_results, portfolio_df


# ============================================================
# Main
# ============================================================

def main():
    config = StrategyConfig(
        price_csv_path="prices.csv",
        sector_csv_path="sector_map.csv",
        train_window=252,
        test_window=63,
        step_size=63,
        n_clusters=5,
        top_pairs_per_cluster=3,
        same_sector_only=True,
        min_correlation=0.70,
        max_cointegration_pvalue=0.05,
        max_adf_pvalue=0.10,
        min_half_life=2,
        max_half_life=60,
        z_window=20,
        z_entry=2.0,
        z_exit=0.5,
        z_stop=3.5,
        max_holding_period=20,
        rolling_beta_window=60,
        transaction_cost_per_leg=0.0005,
        random_state=42,
        plot_examples=True,
        example_plot_count=3
    )

    prices = load_prices(config.price_csv_path)
    sector_map = load_sector_map(config.sector_csv_path)

    common_stocks = sorted(set(prices.columns).intersection(set(sector_map["stock"])))
    prices = prices[common_stocks].copy()
    sector_map = sector_map[sector_map["stock"].isin(common_stocks)].copy()

    print(f"Prices shape: {prices.shape}")
    print(f"Stocks with sector info: {len(common_stocks)}")

    summary_df, trade_log_df, pair_selection_df, pair_results, portfolio_df = run_walk_forward_v2(
        prices, sector_map, config
    )

    print("\n=== Selected Pairs ===")
    if not pair_selection_df.empty:
        print(pair_selection_df.head(20).to_string(index=False))
    else:
        print("No pairs selected.")

    print("\n=== Pair Summary ===")
    if not summary_df.empty:
        print(summary_df.sort_values("Sharpe", ascending=False).head(20).to_string(index=False))
    else:
        print("No pair backtest summary available.")

    print("\n=== Trade Log ===")
    if not trade_log_df.empty:
        print(trade_log_df.head(20).to_string(index=False))
    else:
        print("No trades generated.")

    print("\n=== Portfolio Metrics ===")
    if not portfolio_df.empty:
        metrics = compute_performance_metrics(portfolio_df["portfolio_return"])
        for k, v in metrics.items():
            print(f"{k}: {v:.4f}")
    else:
        print("No portfolio created.")

    if not portfolio_df.empty:
        plot_portfolio_equity(portfolio_df)

    if config.plot_examples and pair_results:
        shown = 0
        for pair_name, df in pair_results.items():
            if shown >= config.example_plot_count:
                break
            parts = pair_name.split("__")
            if len(parts) >= 3:
                stock_a = parts[1]
                stock_b = parts[2]
                plot_pair_example(df, stock_a, stock_b, title_suffix=f"| {pair_name}")
                shown += 1

    # Optional CSV outputs
    if not summary_df.empty:
        summary_df.to_csv("pair_summary_v2.csv", index=False)
    if not trade_log_df.empty:
        trade_log_df.to_csv("trade_log_v2.csv", index=False)
    if not pair_selection_df.empty:
        pair_selection_df.to_csv("selected_pairs_v2.csv", index=False)
    if not portfolio_df.empty:
        portfolio_df.to_csv("portfolio_returns_v2.csv")


if __name__ == "__main__":
    main()