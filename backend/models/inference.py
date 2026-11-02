from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd


PROJECT_DIR = Path(__file__).resolve().parents[2]
MODEL_PATH = Path(os.getenv("NEXUS_LGB_MODEL", PROJECT_DIR / "lgb_model.txt"))
CONFIG_PATH = Path(os.getenv("NEXUS_LGB_CONFIG", PROJECT_DIR / "inference_config.json"))
DATABASE_PATH = Path(os.getenv("NEXUS_DATABASE", PROJECT_DIR / "FMCG_Modelling_Dataset.db"))


class ForecastPipelineError(RuntimeError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class ModelBundle:
    booster: lgb.Booster
    config: dict[str, Any]
    artifact_hash: str
    reference_prediction: float
    reference_error: float


@lru_cache(maxsize=1)
def load_model_bundle() -> ModelBundle:
    if not MODEL_PATH.is_file() or not CONFIG_PATH.is_file():
        raise ForecastPipelineError("MODEL_ARTIFACT_MISSING", "LightGBM model or inference configuration is missing.")
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    features = config.get("ordered_features", [])
    if len(features) != 56 or len(features) != len(set(features)):
        raise ForecastPipelineError("INVALID_FEATURE_SCHEMA", "Inference configuration must contain 56 unique ordered features.")
    booster = lgb.Booster(model_file=str(MODEL_PATH))
    if booster.num_feature() != len(features):
        raise ForecastPipelineError("FEATURE_COUNT_MISMATCH", "Model and configuration feature counts differ.")
    reference = config["inference_validation"]
    reference_row = reference["ordered_feature_row"]
    matrix = np.asarray([[reference_row[name] for name in features]], dtype=np.float32)
    prediction = float(np.clip(booster.predict(matrix, num_iteration=config["best_iteration"]), 0, None)[0])
    expected = float(reference["predicted_sales"])
    error = abs(prediction - expected)
    if error > 50:
        raise ForecastPipelineError(
            "REFERENCE_PREDICTION_FAILED", "Model failed its supplied reference prediction.",
            {"actual": prediction, "expected": expected, "absolute_error": error},
        )
    artifact_hash = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()[:16]
    return ModelBundle(booster, config, artifact_hash, prediction, error)


def model_status() -> dict[str, Any]:
    try:
        bundle = load_model_bundle()
        return {
            "available": True,
            "name": bundle.config["model_name"],
            "artifact_hash": bundle.artifact_hash,
            "runtime_version": lgb.__version__,
            "features": bundle.booster.num_feature(),
            "trees": bundle.booster.num_trees(),
            "validated_horizon_days": bundle.config["forecast_horizon_days"],
            "reference_prediction": bundle.reference_prediction,
            "reference_error": bundle.reference_error,
        }
    except Exception as exc:
        return {"available": False, "reason": str(exc)}


def _read_series(store: int, family: str, origin: pd.Timestamp) -> pd.DataFrame:
    with sqlite3.connect(f"file:{DATABASE_PATH.resolve().as_posix()}?mode=ro", uri=True) as connection:
        frame = pd.read_sql_query(
            "SELECT * FROM all_data WHERE store_nbr = ? AND family = ? AND date <= ? ORDER BY date",
            connection, params=(store, family, origin.strftime("%Y-%m-%d")),
        )
    if frame.empty:
        raise ForecastPipelineError("UNSUPPORTED_SERIES", "The selected store-family series is not supported.")
    frame["date"] = pd.to_datetime(frame["date"])
    if frame["date"].duplicated().any():
        raise ForecastPipelineError("DUPLICATE_HISTORY", "Historical data contains duplicate series/date records.")
    return frame


def _training_transaction_medians(store: int) -> dict[int, float]:
    with sqlite3.connect(f"file:{DATABASE_PATH.resolve().as_posix()}?mode=ro", uri=True) as connection:
        rows = connection.execute(
            """SELECT CAST(strftime('%w', date) AS INTEGER), transactions
               FROM all_data WHERE store_nbr = ? AND date <= '2016-11-30'
               AND transactions_missing = 0 GROUP BY date, store_nbr""", (store,),
        ).fetchall()
    groups: dict[int, list[float]] = {}
    for sqlite_weekday, value in rows:
        polars_weekday = 7 if sqlite_weekday == 0 else sqlite_weekday
        groups.setdefault(polars_weekday, []).append(float(value))
    return {weekday: float(np.median(values)) for weekday, values in groups.items()}


def _calendar_features(day: pd.Timestamp) -> dict[str, float]:
    weekday = day.weekday() + 1
    return {
        "day_of_week": weekday, "month": day.month, "quarter": day.quarter,
        "day_of_month": day.day, "year": day.year, "day_of_year": day.dayofyear,
        "is_weekend": int(weekday in (6, 7)), "is_month_start": int(day.day <= 3),
        "is_month_end": int(day.day >= 28), "is_payday": int(day.day in (15, 30, 31)),
    }


def _sample_std(values: list[float]) -> float:
    return float(np.std(values, ddof=1)) if len(values) > 1 else 0.0


def forecast_series(
    store: int, family: str, horizon_days: int, as_of_date: date | None,
    future_events: list[dict[str, Any]], assume_no_unlisted_events: bool,
) -> dict[str, Any]:
    bundle = load_model_bundle()
    config = bundle.config
    maximum = int(config["forecast_horizon_days"])
    if not 1 <= horizon_days <= maximum:
        raise ForecastPipelineError("INVALID_HORIZON", f"Horizon must be between 1 and {maximum} days.")
    supported_pairs = {(int(s), f) for s in config["pilot_scope"]["stores"] for f in config["pilot_scope"]["families"]}
    if (store, family) not in supported_pairs:
        raise ForecastPipelineError("UNSUPPORTED_SERIES", "The selected store-family pair is outside the model pilot scope.")

    origin = pd.Timestamp(as_of_date) if as_of_date else pd.Timestamp("2017-08-15")
    history = _read_series(store, family, origin)
    actual_origin = history["date"].max()
    if actual_origin != origin:
        raise ForecastPipelineError("ORIGIN_NOT_AVAILABLE", "No historical observation exists for the requested origin.")
    if len(history) < int(config["minimum_historical_lookback_days"]):
        raise ForecastPipelineError("INSUFFICIENT_HISTORY", "At least 28 historical days are required.")

    event_map: dict[str, dict[str, int]] = {}
    event_columns = ["is_holiday", "is_event", "is_additional", "is_bridge", "is_work_day", "is_transferred", "is_national_event", "is_regional_event", "is_local_event"]
    for event in future_events:
        key = str(event["date"])
        if key in event_map:
            raise ForecastPipelineError("DUPLICATE_EVENT_DATE", f"Duplicate future-event date: {key}")
        event_map[key] = {column: int(event.get(column, 0)) for column in event_columns}
    required_dates = [(origin + pd.Timedelta(days=step)).strftime("%Y-%m-%d") for step in range(1, horizon_days + 1)]
    unexpected_dates = sorted(set(event_map) - set(required_dates))
    if unexpected_dates:
        raise ForecastPipelineError(
            "EVENT_DATE_OUT_OF_RANGE",
            "Future-event dates must fall inside the requested forecast window.",
            {"unexpected_dates": unexpected_dates, "forecast_dates": required_dates},
        )
    missing_dates = [day for day in required_dates if day not in event_map]
    if missing_dates and not assume_no_unlisted_events:
        raise ForecastPipelineError(
            "INCOMPLETE_FUTURE_CALENDAR",
            "Future event coverage is incomplete. Supply events or explicitly assume no unlisted events.",
            {"missing_dates": missing_dates},
        )

    latest = history.iloc[-1]
    encoders = config["label_encoders"]
    static = {
        "cluster": float(latest["cluster"]), "has_perishable": float(latest["has_perishable"]),
        "city_enc": float(encoders["city_enc"][str(latest["city"])]),
        "state_enc": float(encoders["state_enc"][str(latest["state"])]),
        "store_type_enc": float(encoders["store_type_enc"][str(latest["store_type"])]),
        "family_enc": float(encoders["family_enc"][family]),
    }
    sales = history["daily_family_sales"].astype(float).tolist()
    oil_history = history.drop_duplicates("date")["oil_price"].astype(float).ffill().tolist()
    oil_price = float(oil_history[-1])
    tx_medians = _training_transaction_medians(store)
    item_columns = ["avg_item_sales_lag1", "num_items_sold_lag1", "num_records_lag1", "num_classes_lag1"]
    item_defaults = {column: float(history[column].tail(7).mean()) for column in item_columns}
    predictions: list[dict[str, Any]] = []

    for step, day_string in enumerate(required_dates, start=1):
        day = pd.Timestamp(day_string)
        row: dict[str, float] = {**_calendar_features(day), **static}
        row.update(event_map.get(day_string, {column: 0 for column in event_columns}))
        row["oil_price"] = oil_price
        for lag in (1, 2, 3, 7, 14, 28):
            row[f"sales_lag_{lag}"] = sales[-lag]
        for window in (7, 14, 28):
            values = sales[-window:]
            row[f"sales_roll_mean_{window}"] = float(np.mean(values))
            row[f"sales_roll_std_{window}"] = _sample_std(values)
            row[f"sales_roll_median_{window}"] = float(np.median(values))
            row[f"sales_roll_min_{window}"] = float(np.min(values))
            row[f"sales_roll_max_{window}"] = float(np.max(values))
        row["sales_ewm_7"] = float(pd.Series(sales).ewm(span=7, adjust=True).mean().iloc[-1])
        row["zero_days_past_7"] = float(sum(value == 0 for value in sales[-7:]))
        row["oil_roll_mean_7"] = float(np.mean(oil_history[-7:]))
        row["oil_roll_mean_14"] = float(np.mean(oil_history[-14:]))
        row["transactions"] = tx_medians.get(day.weekday() + 1, 0.0)
        row.update(item_defaults)
        ordered = config["ordered_features"]
        matrix = np.asarray([[row[name] for name in ordered]], dtype=np.float32)
        if not np.isfinite(matrix).all():
            raise ForecastPipelineError("INVALID_FEATURE_VALUE", "Feature matrix contains a missing or infinite value.")
        prediction = float(np.clip(bundle.booster.predict(matrix, num_iteration=config["best_iteration"]), 0, None)[0])
        predictions.append({"date": day_string, "prediction": round(prediction, 3), "step": step})
        sales.append(prediction)
        oil_history.append(oil_price)

    values = [point["prediction"] for point in predictions]
    peak_index = int(np.argmax(values))
    historical = [
        {"date": row.date.strftime("%Y-%m-%d"), "actual": round(float(row.daily_family_sales), 3)}
        for row in history.tail(90).itertuples(index=False)
    ]
    return {
        "available": True,
        "model": {
            "name": config["model_name"], "artifact_hash": bundle.artifact_hash,
            "lightgbm_runtime_version": lgb.__version__, "best_iteration": config["best_iteration"],
            "validated_horizon_days": maximum, "reference_error": bundle.reference_error,
        },
        "selection": {"store": store, "family": family, "origin": origin.strftime("%Y-%m-%d"), "horizon_days": horizon_days},
        "forecast_range": {"start": predictions[0]["date"], "end": predictions[-1]["date"]},
        "historical": historical, "forecast": predictions,
        "metrics": {
            "total_predicted_demand": round(float(sum(values)), 3),
            "average_daily_demand": round(float(np.mean(values)), 3),
            "peak_demand": round(float(max(values)), 3), "peak_date": predictions[peak_index]["date"],
        },
        "evaluation": {**config["performance"], "source": "supplied held-out model evaluation metadata"},
        "assumptions": [
            "Negative predictions are clipped to zero.",
            "Oil price is forward-filled from the forecast origin.",
            "Transactions use training-period store-weekday medians.",
            "Item-aggregate lag features use their latest seven-day historical mean.",
            "Unlisted future events are assumed absent." if assume_no_unlisted_events else "Future event indicators were supplied explicitly.",
            "Predictions after day one are recursive and feed subsequent lag and rolling features.",
        ],
    }
