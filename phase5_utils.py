"""
Shared utilities for Phase 5: metrics, data loading, result saving.

Metrics implemented (all operating on actual vs predicted arrays):
  - RMSE
  - MAE
  - MASE  (uses train naïve benchmark: mean(|y_t - y_{t-1}|) per series)
  - RMSSE (scaled version of RMSE using same naïve benchmark)
  - Bias  (mean signed error: mean(pred - actual))
"""
import numpy as np
import polars as pl
import os
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR     = r"C:\Users\Arya C\Work\modeling_output_v2"
RESULTS_DIR = os.path.join(OUT_DIR, "results")
PLOTS_DIR   = os.path.join(OUT_DIR, "plots")
os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(PLOTS_DIR, exist_ok=True)

plt.style.use("seaborn-v0_8-darkgrid")

# ── Feature lists (consistent across all tree models) ───────────────────
FUTURE_KNOWN_FEATS = [
    "day_of_week", "month", "quarter", "day_of_month", "year", "day_of_year",
    "is_weekend", "is_month_start", "is_month_end", "is_payday",
    "is_holiday", "is_event", "is_additional", "is_bridge", "is_work_day",
    "is_transferred", "is_national_event", "is_regional_event", "is_local_event",
    "oil_price", "cluster", "has_perishable",
    "city_enc", "state_enc", "store_type_enc", "family_enc",
]
PAST_ONLY_FEATS = [
    "sales_lag_1", "sales_lag_2", "sales_lag_3",
    "sales_lag_7", "sales_lag_14", "sales_lag_28",
    "sales_roll_mean_7", "sales_roll_std_7", "sales_roll_median_7",
    "sales_roll_min_7", "sales_roll_max_7",
    "sales_roll_mean_14", "sales_roll_std_14", "sales_roll_median_14",
    "sales_roll_min_14", "sales_roll_max_14",
    "sales_roll_mean_28", "sales_roll_std_28", "sales_roll_median_28",
    "sales_roll_min_28", "sales_roll_max_28",
    "sales_ewm_7", "zero_days_past_7",
    "oil_roll_mean_7", "oil_roll_mean_14",
    "transactions",
    "avg_item_sales_lag1", "num_items_sold_lag1",
    "num_records_lag1", "num_classes_lag1",
]
ALL_FEATURES = FUTURE_KNOWN_FEATS + PAST_ONLY_FEATS
TARGET = "daily_family_sales"
ID_COLS = ["date", "store_nbr", "family"]


def load_splits():
    """Load train, val, test splits as Polars DataFrames."""
    train = pl.read_parquet(os.path.join(OUT_DIR, "train_split.parquet"))
    val   = pl.read_parquet(os.path.join(OUT_DIR, "val_split.parquet"))
    test  = pl.read_parquet(os.path.join(OUT_DIR, "test_split.parquet"))
    return train, val, test


def to_numpy(df, cols):
    """Convert Polars DataFrame columns to numpy array."""
    return df.select(cols).to_numpy()


def compute_naive_scale(train_df):
    """
    Compute per-series naïve MAE (mean |y_t - y_{t-1}|) from training data.
    Used as the denominator for MASE and RMSSE.
    Returns a dict: (store_nbr, family) -> naïve_mae
    """
    scales = {}
    series_keys = train_df.select("store_nbr", "family").unique().sort("store_nbr", "family")
    for row in series_keys.iter_rows(named=True):
        s, f = row["store_nbr"], row["family"]
        y = (
            train_df
            .filter((pl.col("store_nbr") == s) & (pl.col("family") == f))
            .sort("date")[TARGET]
            .to_numpy()
        )
        diffs = np.abs(np.diff(y))
        scales[(s, f)] = float(np.mean(diffs)) if len(diffs) > 0 and np.mean(diffs) > 0 else 1.0
    return scales


def compute_metrics(actual, predicted, naive_scale=None):
    """
    Compute RMSE, MAE, MASE, RMSSE, Bias.
    actual, predicted: 1D numpy arrays
    naive_scale: float denominator for MASE/RMSSE (per-series naïve MAE)
    """
    actual    = np.array(actual,    dtype=float)
    predicted = np.array(predicted, dtype=float)
    errors    = predicted - actual

    rmse = float(np.sqrt(np.mean(errors ** 2)))
    mae  = float(np.mean(np.abs(errors)))
    bias = float(np.mean(errors))

    if naive_scale is not None and naive_scale > 0:
        mase  = mae  / naive_scale
        rmsse = rmse / naive_scale
    else:
        mase  = float("nan")
        rmsse = float("nan")

    return {"RMSE": rmse, "MAE": mae, "MASE": mase, "RMSSE": rmsse, "Bias": bias}


def aggregate_metrics(per_series_metrics):
    """
    Average metrics across all series.
    per_series_metrics: list of dicts with RMSE, MAE, MASE, RMSSE, Bias
    """
    keys = ["RMSE", "MAE", "MASE", "RMSSE", "Bias"]
    result = {}
    for k in keys:
        vals = [m[k] for m in per_series_metrics if not np.isnan(m[k])]
        result[k] = float(np.mean(vals)) if vals else float("nan")
    return result


def save_results(model_name, metrics_test, metrics_val, training_time_sec, predictions_df=None):
    """Save metrics and predictions to disk."""
    result = {
        "model": model_name,
        "training_time_sec": round(training_time_sec, 2),
        "test_metrics": metrics_test,
        "val_metrics":  metrics_val,
    }
    path = os.path.join(RESULTS_DIR, f"{model_name}_results.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"  Saved {model_name}_results.json")

    if predictions_df is not None:
        pred_path = os.path.join(RESULTS_DIR, f"{model_name}_predictions.parquet")
        predictions_df.write_parquet(pred_path)
        print(f"  Saved {model_name}_predictions.parquet")

    return result


def plot_series_forecast(model_name, store_nbr, family, train_df, val_df, test_df, preds_val, preds_test):
    """Plot actual vs forecast for a single series."""
    fig, ax = plt.subplots(figsize=(14, 4))

    # Show last 90 days of training
    train_series = (
        train_df
        .filter((pl.col("store_nbr") == store_nbr) & (pl.col("family") == family))
        .sort("date").tail(90)
    )
    val_series = (
        val_df
        .filter((pl.col("store_nbr") == store_nbr) & (pl.col("family") == family))
        .sort("date")
    )
    test_series = (
        test_df
        .filter((pl.col("store_nbr") == store_nbr) & (pl.col("family") == family))
        .sort("date")
    )

    ax.plot(train_series["date"], train_series[TARGET], color="steelblue", linewidth=0.8, label="Train (last 90d)")
    ax.plot(val_series["date"],   val_series[TARGET],   color="orange",    linewidth=1.2, label="Val actual")
    ax.plot(test_series["date"],  test_series[TARGET],  color="green",     linewidth=1.2, label="Test actual")

    if preds_val is not None:
        ax.plot(val_series["date"],  preds_val,  color="red",    linewidth=1.0, linestyle="--", label="Val forecast")
    if preds_test is not None:
        ax.plot(test_series["date"], preds_test, color="purple", linewidth=1.0, linestyle="--", label="Test forecast")

    ax.set_title(f"{model_name} | Store {store_nbr} | {family}", fontsize=12)
    ax.set_xlabel("Date")
    ax.set_ylabel("Daily Family Sales")
    ax.legend(fontsize=8)
    plt.tight_layout()

    fname = f"{model_name}_store{store_nbr}_{family.replace('/', '_').replace(' ', '_').replace(',', '')}.png"
    plt.savefig(os.path.join(PLOTS_DIR, fname), dpi=120)
    plt.close()


def print_metrics(model_name, split_name, metrics):
    print(f"  {model_name} [{split_name}]  RMSE={metrics['RMSE']:.3f}  MAE={metrics['MAE']:.3f}  "
          f"MASE={metrics['MASE']:.3f}  RMSSE={metrics['RMSSE']:.3f}  Bias={metrics['Bias']:.3f}")
