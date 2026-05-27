"""
Diagnostic: for the most recent walk-forward window, show every same-sector
pair candidate and which filter (if any) eliminated it.

Run: python3 diagnose_pairs.py
"""

from itertools import combinations
import pandas as pd

from KMeansPairTrading import (
    StrategyConfig,
    load_prices,
    load_sector_map,
    compute_stock_features,
    cluster_stocks,
    attach_sector_info,
    estimate_static_beta,
    compute_spread,
    adf_pvalue,
    estimate_half_life,
)
from statsmodels.tsa.stattools import coint


def main():
    cfg = StrategyConfig(
        train_window=252,
        test_window=126,
        step_size=63,
        n_clusters=5,
        top_pairs_per_cluster=3,
        same_sector_only=True,
        min_correlation=0.60,
        max_cointegration_pvalue=0.10,
        max_adf_pvalue=0.15,
        min_half_life=2,
        max_half_life=60,
        rolling_beta_window=30,
    )

    prices = load_prices(cfg.price_csv_path)
    sector_map = load_sector_map(cfg.sector_csv_path)
    common = sorted(set(prices.columns).intersection(set(sector_map["stock"])))
    prices = prices[common].copy()

    dates = prices.index
    # Last walk-forward iteration (most recent forward-test window)
    last_start = ((len(dates) - cfg.train_window) // cfg.step_size) * cfg.step_size + cfg.train_window
    if last_start + cfg.test_window > len(dates):
        last_start -= cfg.step_size

    train = prices.iloc[last_start - cfg.train_window:last_start]
    test = prices.iloc[last_start:last_start + cfg.test_window]
    print(f"Forward-test window: train {train.index[0].date()} → {train.index[-1].date()}")
    print(f"                    test  {test.index[0].date()} → {test.index[-1].date()}")
    print()

    feats = compute_stock_features(train)
    clustered = cluster_stocks(feats, cfg.n_clusters, cfg.random_state)
    clustered = attach_sector_info(clustered, sector_map)

    # Show cluster membership
    print("Cluster membership:")
    for cid in sorted(clustered["cluster"].unique()):
        members = clustered[clustered["cluster"] == cid]
        sectors = members["sector"].value_counts().to_dict()
        print(f"  Cluster {cid}: {len(members)} stocks  sectors={sectors}")
        for stock in members.index:
            print(f"    {stock} ({members.loc[stock, 'sector']})")
    print()

    # Try every same-sector pair and report verdict
    print(f"{'PAIR':<28} {'SECTOR':<8} {'CL':<3} {'CORR':>6} {'COINT':>8} {'ADF':>8} {'HL':>6}  {'VERDICT'}")
    print("-" * 110)

    rows = []
    pass_count = 0
    for cid in sorted(clustered["cluster"].unique()):
        members = clustered[clustered["cluster"] == cid].index.tolist()
        if len(members) < 2:
            continue
        for a, b in combinations(members, 2):
            sa = clustered.loc[a, "sector"]
            sb = clustered.loc[b, "sector"]
            if cfg.same_sector_only and sa != sb:
                continue

            pair_px = train[[a, b]].dropna()
            if len(pair_px) < cfg.min_history_required:
                rows.append((f"{a}/{b}", sa, cid, None, None, None, None, "FAIL: insufficient history"))
                continue

            y, x = pair_px[a], pair_px[b]
            corr = y.pct_change().corr(x.pct_change())

            verdict = []
            if pd.isna(corr) or corr < cfg.min_correlation:
                verdict.append(f"corr<{cfg.min_correlation}")

            try:
                _, coint_p, _ = coint(y, x)
            except Exception:
                coint_p = None
                verdict.append("coint failed")

            if coint_p is not None and coint_p > cfg.max_cointegration_pvalue:
                verdict.append(f"coint p>{cfg.max_cointegration_pvalue}")

            beta = estimate_static_beta(y, x)
            spread = compute_spread(y, x, beta)
            adf_p = adf_pvalue(spread)
            if adf_p > cfg.max_adf_pvalue:
                verdict.append(f"adf p>{cfg.max_adf_pvalue}")

            hl = estimate_half_life(spread)
            if hl is None:
                verdict.append("hl undefined")
            elif not (cfg.min_half_life <= hl <= cfg.max_half_life):
                verdict.append(f"hl={hl:.1f} out of [{cfg.min_half_life},{cfg.max_half_life}]")

            ok = len(verdict) == 0
            if ok:
                pass_count += 1
            label = "✓ PASS" if ok else "✗ " + "; ".join(verdict)
            rows.append((f"{a}/{b}", sa, cid, corr, coint_p, adf_p, hl, label))

    # Sort: passes first, then by lowest cointegration p
    def sort_key(r):
        passed = r[7].startswith("✓")
        return (0 if passed else 1, r[4] if r[4] is not None else 99)

    rows.sort(key=sort_key)
    for pair, sec, cid, corr, cp, ap, hl, verdict in rows:
        corr_s = f"{corr:.3f}" if corr is not None else "  -"
        cp_s = f"{cp:.4f}" if cp is not None else "    -"
        ap_s = f"{ap:.4f}" if ap is not None else "    -"
        hl_s = f"{hl:.1f}" if hl is not None else "  -"
        print(f"{pair:<28} {sec:<8} {cid:<3} {corr_s:>6} {cp_s:>8} {ap_s:>8} {hl_s:>6}  {verdict}")

    print(f"\n{pass_count} same-sector pairs pass all filters.")
    print(f"With top_pairs_per_cluster={cfg.top_pairs_per_cluster}, max selectable = {cfg.top_pairs_per_cluster * cfg.n_clusters} pairs.")


if __name__ == "__main__":
    main()
