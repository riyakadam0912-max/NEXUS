"""
Phase 5 — Models 2 & 3: XGBoost and LightGBM
Both use the same supervised feature matrix for a fair comparison.
Global model: trained on all 225 series at once.
Predictions clipped to >= 0 (sales cannot be negative).
"""
import sys
import os
import time
import warnings
import numpy as np
import polars as pl
import xgboost as xgb
import lightgbm as lgb

sys.path.insert(0, r"C:\Users\Arya C\Work")
sys.stdout.reconfigure(encoding="utf-8")
warnings.filterwarnings("ignore")

from phase5_utils import (
    load_splits, compute_naive_scale, compute_metrics,
    aggregate_metrics, save_results, plot_series_forecast, print_metrics,
    ALL_FEATURES, TARGET, ID_COLS, PLOTS_DIR, RESULTS_DIR
)

print("=" * 70)
print("MODELS 2 & 3: XGBoost and LightGBM")
print("=" * 70)

train_df, val_df, test_df = load_splits()

# Build numpy arrays for train / val / test
X_train = train_df.select(ALL_FEATURES).to_numpy().astype(np.float32)
y_train = train_df[TARGET].to_numpy().astype(np.float32)
X_val   = val_df.select(ALL_FEATURES).to_numpy().astype(np.float32)
y_val   = val_df[TARGET].to_numpy().astype(np.float32)
X_test  = test_df.select(ALL_FEATURES).to_numpy().astype(np.float32)
y_test  = test_df[TARGET].to_numpy().astype(np.float32)

print(f"  Train: {X_train.shape}  Val: {X_val.shape}  Test: {X_test.shape}")

# Precompute naïve scales per series for MASE/RMSSE
naive_scales = compute_naive_scale(train_df)

def per_series_metrics_from_preds(df, preds_array, naive_scales):
    """Compute per-series metrics from a flat predictions array aligned with df rows."""
    df = df.with_columns(pl.Series("prediction", preds_array.tolist()))
    keys = df.select("store_nbr", "family").unique().sort("store_nbr", "family")
    per_series = []
    for row in keys.iter_rows(named=True):
        s, f = row["store_nbr"], row["family"]
        sub = df.filter((pl.col("store_nbr") == s) & (pl.col("family") == f)).sort("date")
        actual = sub[TARGET].to_numpy()
        pred   = sub["prediction"].to_numpy()
        scale  = naive_scales.get((s, f), 1.0)
        per_series.append(compute_metrics(actual, pred, naive_scale=scale))
    return per_series

PLOT_SERIES = [(44, "GROCERY I"), (44, "BEVERAGES"), (3, "PRODUCE"), (3, "CLEANING")]

# ────────────────────────────────────────────────────────────────────────
# MODEL 2: XGBoost
# ────────────────────────────────────────────────────────────────────────
print()
print("--- XGBoost ---")

xgb_params = {
    "objective":        "reg:squarederror",
    "n_estimators":     800,
    "learning_rate":    0.05,
    "max_depth":        7,
    "min_child_weight": 5,
    "subsample":        0.8,
    "colsample_bytree": 0.8,
    "reg_alpha":        0.1,
    "reg_lambda":       1.0,
    "tree_method":      "hist",
    "device":           "cpu",
    "random_state":     42,
    "n_jobs":           -1,
    "early_stopping_rounds": 50,
    "eval_metric":      "rmse",
}

t0 = time.time()
xgb_model = xgb.XGBRegressor(**xgb_params)
xgb_model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    verbose=100,
)
xgb_time = time.time() - t0
print(f"  XGBoost training time: {xgb_time:.1f}s")

xgb_preds_val  = np.clip(xgb_model.predict(X_val),  0, None)
xgb_preds_test = np.clip(xgb_model.predict(X_test), 0, None)

xgb_metrics_val  = aggregate_metrics(per_series_metrics_from_preds(val_df,  xgb_preds_val,  naive_scales))
xgb_metrics_test = aggregate_metrics(per_series_metrics_from_preds(test_df, xgb_preds_test, naive_scales))

print_metrics("XGBoost", "Validation", xgb_metrics_val)
print_metrics("XGBoost", "Test",       xgb_metrics_test)

# Save
xgb_preds_df = pl.concat([
    val_df.select(ID_COLS).with_columns(
        pl.Series("prediction", xgb_preds_val.tolist()),
        pl.lit("val").alias("split")
    ),
    test_df.select(ID_COLS).with_columns(
        pl.Series("prediction", xgb_preds_test.tolist()),
        pl.lit("test").alias("split")
    ),
])
save_results("XGBoost", xgb_metrics_test, xgb_metrics_val, xgb_time, xgb_preds_df)

# Plots
print("  Generating XGBoost plots...")
for s, f in PLOT_SERIES:
    pv = xgb_preds_df.filter((pl.col("store_nbr")==s)&(pl.col("family")==f)&(pl.col("split")=="val")).sort("date")["prediction"].to_numpy()
    pt = xgb_preds_df.filter((pl.col("store_nbr")==s)&(pl.col("family")==f)&(pl.col("split")=="test")).sort("date")["prediction"].to_numpy()
    plot_series_forecast("XGBoost", s, f, train_df, val_df, test_df, pv, pt)

# ────────────────────────────────────────────────────────────────────────
# MODEL 3: LightGBM
# ────────────────────────────────────────────────────────────────────────
print()
print("--- LightGBM ---")

lgb_params = {
    "objective":         "regression",
    "metric":            "rmse",
    "n_estimators":      800,
    "learning_rate":     0.05,
    "num_leaves":        63,
    "max_depth":         -1,
    "min_child_samples": 20,
    "subsample":         0.8,
    "colsample_bytree":  0.8,
    "reg_alpha":         0.1,
    "reg_lambda":        1.0,
    "random_state":      42,
    "n_jobs":            -1,
    "verbose":           -1,
}

t0 = time.time()
lgb_model = lgb.LGBMRegressor(**lgb_params)
lgb_model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    callbacks=[
        lgb.early_stopping(stopping_rounds=50, verbose=False),
        lgb.log_evaluation(period=100),
    ],
)
lgb_time = time.time() - t0
print(f"  LightGBM training time: {lgb_time:.1f}s")

lgb_preds_val  = np.clip(lgb_model.predict(X_val),  0, None)
lgb_preds_test = np.clip(lgb_model.predict(X_test), 0, None)

lgb_metrics_val  = aggregate_metrics(per_series_metrics_from_preds(val_df,  lgb_preds_val,  naive_scales))
lgb_metrics_test = aggregate_metrics(per_series_metrics_from_preds(test_df, lgb_preds_test, naive_scales))

print_metrics("LightGBM", "Validation", lgb_metrics_val)
print_metrics("LightGBM", "Test",       lgb_metrics_test)

# Save
lgb_preds_df = pl.concat([
    val_df.select(ID_COLS).with_columns(
        pl.Series("prediction", lgb_preds_val.tolist()),
        pl.lit("val").alias("split")
    ),
    test_df.select(ID_COLS).with_columns(
        pl.Series("prediction", lgb_preds_test.tolist()),
        pl.lit("test").alias("split")
    ),
])
save_results("LightGBM", lgb_metrics_test, lgb_metrics_val, lgb_time, lgb_preds_df)

# Plots
print("  Generating LightGBM plots...")
for s, f in PLOT_SERIES:
    pv = lgb_preds_df.filter((pl.col("store_nbr")==s)&(pl.col("family")==f)&(pl.col("split")=="val")).sort("date")["prediction"].to_numpy()
    pt = lgb_preds_df.filter((pl.col("store_nbr")==s)&(pl.col("family")==f)&(pl.col("split")=="test")).sort("date")["prediction"].to_numpy()
    plot_series_forecast("LightGBM", s, f, train_df, val_df, test_df, pv, pt)

print()
print("=" * 70)
print("XGBoost & LightGBM COMPLETE")
print(f"  XGBoost  Val  — RMSE:{xgb_metrics_val['RMSE']:.3f}  MAE:{xgb_metrics_val['MAE']:.3f}  MASE:{xgb_metrics_val['MASE']:.3f}  Bias:{xgb_metrics_val['Bias']:.3f}")
print(f"  XGBoost  Test — RMSE:{xgb_metrics_test['RMSE']:.3f}  MAE:{xgb_metrics_test['MAE']:.3f}  MASE:{xgb_metrics_test['MASE']:.3f}  Bias:{xgb_metrics_test['Bias']:.3f}")
print(f"  LightGBM Val  — RMSE:{lgb_metrics_val['RMSE']:.3f}  MAE:{lgb_metrics_val['MAE']:.3f}  MASE:{lgb_metrics_val['MASE']:.3f}  Bias:{lgb_metrics_val['Bias']:.3f}")
print(f"  LightGBM Test — RMSE:{lgb_metrics_test['RMSE']:.3f}  MAE:{lgb_metrics_test['MAE']:.3f}  MASE:{lgb_metrics_test['MASE']:.3f}  Bias:{lgb_metrics_test['Bias']:.3f}")
print("=" * 70)
