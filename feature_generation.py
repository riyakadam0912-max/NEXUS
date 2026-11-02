"""
feature_generation.py
NEXUS LightGBM Feature Generation Script
=========================================
Reproduces the exact feature set used to train the NEXUS LightGBM model.
Input : raw CSV files from Corporacion Favorita dataset
Output: train_split.parquet, val_split.parquet, test_split.parquet

Pipeline order (leakage-safe):
  1. Clean oil, holidays, stores, items
  2. Aggregate train.csv to daily store-family level
  3. Build complete date grid, join all tables
  4. SPLIT (train/val/test)
  5. Post-split feature engineering — all fitted on train only
"""
from datetime import date
import polars as pl
import numpy as np
import os

RAW_DIR = os.path.join(os.path.expanduser("~"), "Work", "raw data")
OUT_DIR = os.path.join(os.path.expanduser("~"), "Work", "modeling_output_v2")

TRAIN_END  = date(2016, 11, 30)
VAL_START  = date(2016, 12,  1)
VAL_END    = date(2017,  5, 31)
TEST_START = date(2017,  6,  1)
TEST_END   = date(2017,  8, 15)

PILOT_STORES = [2, 3, 7, 8, 9, 11, 24, 44, 45, 46, 47, 48, 49, 50, 51]
PILOT_FAMILIES = [
    "GROCERY I", "BEVERAGES", "PRODUCE", "CLEANING", "DAIRY",
    "BREAD/BAKERY", "POULTRY", "MEATS", "PERSONAL CARE", "DELI",
    "EGGS", "HOME CARE", "FROZEN FOODS", "PREPARED FOODS", "LIQUOR,WINE,BEER",
]
DATE_MIN = date(2013, 1, 1)
DATE_MAX = date(2017, 8, 15)

# ── ORDERED feature list — must match this exact order for inference ──────
ALL_FEATURES = [
    "day_of_week", "month", "quarter", "day_of_month", "year", "day_of_year",
    "is_weekend", "is_month_start", "is_month_end", "is_payday",
    "is_holiday", "is_event", "is_additional", "is_bridge", "is_work_day",
    "is_transferred", "is_national_event", "is_regional_event", "is_local_event",
    "oil_price", "cluster", "has_perishable",
    "city_enc", "state_enc", "store_type_enc", "family_enc",
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
TARGET = "daily_family_sales"

# Encoders fitted on training data only
ENCODERS = {
    "city":       {"Ambato": 0, "Cayambe": 1, "Guayaquil": 2, "Quito": 3},
    "state":      {"Guayas": 0, "Pichincha": 1, "Tungurahua": 2},
    "store_type": {"A": 0, "B": 1, "D": 2},
    "family":     {
        "BEVERAGES": 0, "BREAD/BAKERY": 1, "CLEANING": 2, "DAIRY": 3,
        "DELI": 4, "EGGS": 5, "FROZEN FOODS": 6, "GROCERY I": 7,
        "HOME CARE": 8, "LIQUOR,WINE,BEER": 9, "MEATS": 10,
        "PERSONAL CARE": 11, "POULTRY": 12, "PREPARED FOODS": 13, "PRODUCE": 14,
    },
}

# ── Step 1: Clean oil ─────────────────────────────────────────────────────
oil = pl.read_csv(os.path.join(RAW_DIR, "oil.csv"), try_parse_dates=True)
oil = oil.rename({"dcoilwtico": "oil_price"})
calendar = pl.DataFrame({"date": pl.date_range(DATE_MIN, DATE_MAX, interval="1d", eager=True)})
oil_daily = (
    calendar.join(oil, on="date", how="left")
    .with_columns(pl.col("oil_price").forward_fill())
    .with_columns(pl.col("oil_price").backward_fill())
)

# ── Step 2: Clean holidays ────────────────────────────────────────────────
holidays = pl.read_csv(os.path.join(RAW_DIR, "holidays_events.csv"), try_parse_dates=True)
holiday_daily = holidays.group_by("date").agg(
    pl.when((pl.col("type") == "Holiday") & (pl.col("transferred") == False))
      .then(1).otherwise(0).max().alias("is_holiday"),
    pl.when(pl.col("type") == "Event").then(1).otherwise(0).max().alias("is_event"),
    pl.when(pl.col("type") == "Additional").then(1).otherwise(0).max().alias("is_additional"),
    pl.when(pl.col("type") == "Bridge").then(1).otherwise(0).max().alias("is_bridge"),
    pl.when(pl.col("type") == "Work Day").then(1).otherwise(0).max().alias("is_work_day"),
    pl.when(pl.col("transferred") == True).then(1).otherwise(0).max().alias("is_transferred"),
    pl.when(pl.col("locale") == "National").then(1).otherwise(0).max().alias("is_national_event"),
    pl.when(pl.col("locale") == "Regional").then(1).otherwise(0).max().alias("is_regional_event"),
    pl.when(pl.col("locale") == "Local").then(1).otherwise(0).max().alias("is_local_event"),
)

# ── Step 3: Load stores, items, transactions ──────────────────────────────
stores = pl.read_csv(os.path.join(RAW_DIR, "stores.csv"), try_parse_dates=True)
stores = (
    stores.with_columns([
        pl.col("city").str.strip_chars(),
        pl.col("state").str.strip_chars(),
        pl.col("type").str.strip_chars().alias("store_type"),
    ]).drop("type").select(["store_nbr", "city", "state", "store_type", "cluster"])
)
items = pl.read_csv(os.path.join(RAW_DIR, "items.csv"), try_parse_dates=True)
items = items.with_columns(pl.col("family").str.strip_chars())
transactions = pl.read_csv(os.path.join(RAW_DIR, "transactions.csv"), try_parse_dates=True)

# ── Step 4: Aggregate train.csv to daily store-family (year by year) ──────
pilot_items = items.filter(pl.col("family").is_in(PILOT_FAMILIES)).select(
    "item_nbr", "family", "class", "perishable"
)
agg_parts = []
for yr in range(2013, 2018):
    lf = pl.scan_csv(os.path.join(RAW_DIR, "train.csv"), try_parse_dates=True)
    year_df = (
        lf.filter(pl.col("date").dt.year() == yr)
          .filter(pl.col("store_nbr").is_in(PILOT_STORES))
          .join(pilot_items.lazy(), on="item_nbr", how="inner")
          .collect(engine="streaming")
    )
    year_df = year_df.with_columns(
        pl.when(pl.col("unit_sales") < 0)
          .then(0.0).otherwise(pl.col("unit_sales")).alias("unit_sales")
    )
    agg = year_df.group_by("date", "store_nbr", "family").agg(
        pl.col("unit_sales").sum().alias("daily_family_sales"),
        pl.col("unit_sales").mean().alias("avg_item_sales"),
        pl.col("item_nbr").n_unique().alias("num_items_sold"),
        pl.len().alias("num_records"),
        pl.col("class").n_unique().alias("num_classes"),
        pl.col("perishable").max().alias("has_perishable"),
    ).sort("date", "store_nbr", "family")
    agg_parts.append(agg)
    print(f"  Year {yr}: {year_df.height:,} rows -> {agg.height:,} agg rows")

daily_agg = pl.concat(agg_parts).group_by("date", "store_nbr", "family").agg(
    pl.col("daily_family_sales").sum(),
    pl.col("avg_item_sales").mean(),
    pl.col("num_items_sold").sum(),
    pl.col("num_records").sum(),
    pl.col("num_classes").max(),
    pl.col("has_perishable").max(),
).sort("date", "store_nbr", "family")

# ── Step 5: Build complete grid and join all tables ───────────────────────
all_dates = pl.DataFrame({"date": pl.date_range(DATE_MIN, DATE_MAX, interval="1d", eager=True)})
combos = pl.DataFrame([{"store_nbr": s, "family": f}
                        for s in PILOT_STORES for f in PILOT_FAMILIES])
base = all_dates.join(combos, how="cross")
base = base.join(daily_agg, on=["date", "store_nbr", "family"], how="left")
base = base.with_columns([
    pl.col("daily_family_sales").fill_null(0.0),
    pl.col("avg_item_sales").fill_null(0.0),
    pl.col("num_items_sold").fill_null(0).cast(pl.UInt32),
    pl.col("num_records").fill_null(0).cast(pl.UInt32),
    pl.col("num_classes").fill_null(0).cast(pl.UInt32),
    pl.col("has_perishable").fill_null(0),
])
base = base.join(stores.filter(pl.col("store_nbr").is_in(PILOT_STORES)), on="store_nbr", how="left")
base = base.join(oil_daily, on="date", how="left")
base = base.join(holiday_daily, on="date", how="left")
for col in ["is_holiday", "is_event", "is_additional", "is_bridge", "is_work_day",
            "is_transferred", "is_national_event", "is_regional_event", "is_local_event"]:
    base = base.with_columns(pl.col(col).fill_null(0))
base = base.join(transactions, on=["date", "store_nbr"], how="left")
base = base.with_columns(pl.col("transactions").is_null().cast(pl.Int8).alias("transactions_missing"))
base = base.sort("date", "store_nbr", "family")

# ── Step 6: SPLIT FIRST (before any feature engineering) ─────────────────
train_raw = base.filter(pl.col("date") <= TRAIN_END)
val_raw   = base.filter((pl.col("date") >= VAL_START) & (pl.col("date") <= VAL_END))
test_raw  = base.filter(pl.col("date") >= TEST_START)

# ── Step 7: Post-split processing — everything fitted on train only ───────
full = pl.concat([train_raw, val_raw, test_raw]).sort("date", "store_nbr", "family")

# 7a: Impute transactions with TRAIN-only store-weekday medians
full = full.with_columns(pl.col("date").dt.weekday().alias("_dow"))
train_obs = full.filter(
    (pl.col("date") <= TRAIN_END) & (pl.col("transactions_missing") == 0)
)
store_dow_medians = (
    train_obs.group_by("store_nbr", "_dow")
    .agg(pl.col("transactions").median().alias("tx_median"))
)
full = full.join(store_dow_medians, on=["store_nbr", "_dow"], how="left")
full = full.with_columns(
    pl.when(pl.col("transactions").is_null())
      .then(pl.col("tx_median").fill_null(0))
      .otherwise(pl.col("transactions"))
      .alias("transactions")
).drop(["tx_median", "_dow"])

# 7b: Calendar features (deterministic — no fitting needed)
full = full.with_columns([
    pl.col("date").dt.weekday().alias("day_of_week"),
    pl.col("date").dt.month().alias("month"),
    pl.col("date").dt.quarter().alias("quarter"),
    pl.col("date").dt.day().alias("day_of_month"),
    pl.col("date").dt.year().alias("year"),
    pl.col("date").dt.ordinal_day().alias("day_of_year"),
])
full = full.with_columns([
    pl.when(pl.col("day_of_week").is_in([6, 7])).then(1).otherwise(0).alias("is_weekend"),
    pl.when(pl.col("day_of_month") <= 3).then(1).otherwise(0).alias("is_month_start"),
    pl.when(pl.col("day_of_month") >= 28).then(1).otherwise(0).alias("is_month_end"),
    pl.when(pl.col("day_of_month").is_in([15, 30, 31])).then(1).otherwise(0).alias("is_payday"),
])

# 7c: Lag contemporaneous item-level features (shift 1 day — prevent leakage)
for col in ["avg_item_sales", "num_items_sold", "num_records", "num_classes"]:
    full = full.with_columns(
        pl.col(col).shift(1).over("store_nbr", "family")
          .fill_null(0).alias(f"{col}_lag1")
    )
full = full.drop(["avg_item_sales", "num_items_sold", "num_records", "num_classes"])

# 7d: Sales lag features
for lag in [1, 2, 3, 7, 14, 28]:
    full = full.with_columns(
        pl.col("daily_family_sales").shift(lag).over("store_nbr", "family")
          .fill_null(0).alias(f"sales_lag_{lag}")
    )

# 7e: Rolling statistics — shift(1) first so window = [t-w, t-1] (no leakage)
for window in [7, 14, 28]:
    shifted = pl.col("daily_family_sales").shift(1)
    full = full.with_columns([
        shifted.rolling_mean(window_size=window).over("store_nbr","family").fill_null(0).alias(f"sales_roll_mean_{window}"),
        shifted.rolling_std(window_size=window).over("store_nbr","family").fill_null(0).alias(f"sales_roll_std_{window}"),
        shifted.rolling_median(window_size=window).over("store_nbr","family").fill_null(0).alias(f"sales_roll_median_{window}"),
        shifted.rolling_min(window_size=window).over("store_nbr","family").fill_null(0).alias(f"sales_roll_min_{window}"),
        shifted.rolling_max(window_size=window).over("store_nbr","family").fill_null(0).alias(f"sales_roll_max_{window}"),
    ])
for w in [7, 14]:
    full = full.with_columns(
        pl.col("oil_price").shift(1).rolling_mean(window_size=w)
          .over("store_nbr", "family").fill_null(0).alias(f"oil_roll_mean_{w}")
    )
full = full.with_columns(
    pl.col("daily_family_sales").shift(1).ewm_mean(span=7)
      .over("store_nbr", "family").fill_null(0).alias("sales_ewm_7")
)
full = full.with_columns(
    (pl.col("daily_family_sales") == 0).cast(pl.Int64).shift(1)
      .rolling_sum(window_size=7).over("store_nbr", "family")
      .fill_null(0).alias("zero_days_past_7")
)

# 7f: Label encoding — vocabulary from TRAIN only, applied to all splits
for col, mapping in ENCODERS.items():
    full = full.with_columns(
        pl.col(col).map_elements(lambda v, m=mapping: m.get(v, -1), return_dtype=pl.Int32)
          .alias(f"{col}_enc")
    )

# ── Step 8: Re-split and save ─────────────────────────────────────────────
train_final = full.filter(pl.col("date") <= TRAIN_END)
val_final   = full.filter((pl.col("date") >= VAL_START) & (pl.col("date") <= VAL_END))
test_final  = full.filter(pl.col("date") >= TEST_START)

train_final.write_parquet(os.path.join(OUT_DIR, "train_split.parquet"))
val_final.write_parquet(os.path.join(OUT_DIR, "val_split.parquet"))
test_final.write_parquet(os.path.join(OUT_DIR, "test_split.parquet"))

print(f"train_split.parquet : {train_final.height:,} rows x {train_final.width} cols")
print(f"val_split.parquet   : {val_final.height:,} rows x {val_final.width} cols")
print(f"test_split.parquet  : {test_final.height:,} rows x {test_final.width} cols")
print("Done.")
