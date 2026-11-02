from __future__ import annotations

from functools import lru_cache
from datetime import date
from math import ceil, sqrt
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from statistics import NormalDist
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from models.inference import ForecastPipelineError, forecast_series, model_status

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATABASE_PATH = BASE_DIR.parent / "FMCG_Modelling_Dataset.db"
MAX_CSV_BYTES = 250 * 1024 * 1024
DATASETS = {
    "sales": ("sales_daily.parquet", "sales_daily.csv", "sales.parquet"),
    "stores": ("stores.csv", "stores.parquet"),
    "products": ("items.csv", "products.csv", "items.parquet"),
    "transactions": ("transactions.csv", "transactions.parquet"),
    "holidays": ("holidays_events.csv", "holidays.csv"),
    "oil": ("oil.csv", "oil.parquet"),
    "inventory": ("inventory.csv", "inventory.parquet"),
    "forecasts": ("forecast_results.parquet", "forecast_results.csv"),
}

app = FastAPI(
    title="NEXUS Demand Intelligence API",
    version="1.0.0",
    description="Data-backed FMCG analytics. Missing source data and model artifacts are reported explicitly.",
)
configured_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")
production_origins = os.getenv(
    "PRODUCTION_CORS_ORIGINS",
    "https://nexus-sand-five-22.vercel.app",
).split(",")
allowed_origins = list(
    dict.fromkeys(
        origin.strip()
        for origin in [*configured_origins, *production_origins]
        if origin.strip()
    )
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FutureEvent(BaseModel):
    date: date
    is_holiday: int = Field(default=0, ge=0, le=1)
    is_event: int = Field(default=0, ge=0, le=1)
    is_additional: int = Field(default=0, ge=0, le=1)
    is_bridge: int = Field(default=0, ge=0, le=1)
    is_work_day: int = Field(default=0, ge=0, le=1)
    is_transferred: int = Field(default=0, ge=0, le=1)
    is_national_event: int = Field(default=0, ge=0, le=1)
    is_regional_event: int = Field(default=0, ge=0, le=1)
    is_local_event: int = Field(default=0, ge=0, le=1)


class ForecastRequest(BaseModel):
    store: int = Field(gt=0)
    family: str
    horizon_days: int = Field(default=28, ge=1, le=76)
    as_of_date: date | None = None
    future_events: list[FutureEvent] = Field(default_factory=list)
    assume_no_unlisted_events: bool = False


class InventoryRequest(BaseModel):
    average_daily_demand: float = Field(ge=0)
    daily_demand_std: float = Field(ge=0)
    on_hand: float = Field(ge=0)
    incoming: float = Field(ge=0)
    backorders: float = Field(ge=0)
    lead_time_days: int = Field(ge=0)
    review_period_days: int = Field(ge=0)
    service_level: float = Field(gt=0.5, lt=1)
    shelf_life_days: int | None = Field(default=None, gt=0)


def _find_path(dataset: str) -> Path | None:
    for filename in DATASETS[dataset]:
        candidate = DATA_DIR / filename
        if candidate.is_file():
            return candidate
    if DATASETS[dataset] and DATABASE_PATH.is_file() and dataset in {
        "sales", "stores", "products", "transactions", "holidays", "oil"
    }:
        return DATABASE_PATH
    return None


@lru_cache(maxsize=12)
def _read_cached(path_string: str, modified_ns: int) -> pd.DataFrame:
    path = Path(path_string)
    if path.suffix == ".parquet":
        return pd.read_parquet(path)
    if path.stat().st_size > MAX_CSV_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"{path.name} is larger than 250 MB. Convert the source into a filtered "
                "daily Parquet aggregate before loading it into the demo."
            ),
        )
    return pd.read_csv(path, low_memory=False)


@lru_cache(maxsize=6)
def _read_database(dataset: str, path_string: str, modified_ns: int) -> pd.DataFrame:
    path = Path(path_string).resolve().as_posix()
    queries = {
        "sales": """
            SELECT date, store_nbr, family, daily_family_sales AS unit_sales,
                   has_perishable, city, state, store_type, cluster, oil_price,
                   is_holiday, is_event, is_national_event, is_regional_event, is_local_event
            FROM all_data
        """,
        "stores": """
            SELECT store_nbr, city, state, store_type, cluster
            FROM all_data
            GROUP BY store_nbr, city, state, store_type, cluster
            ORDER BY store_nbr
        """,
        "products": """
            SELECT family, MAX(has_perishable) AS perishable
            FROM all_data
            GROUP BY family
            ORDER BY family
        """,
        "transactions": """
            SELECT date, store_nbr, MAX(transactions) AS transactions
            FROM all_data
            WHERE transactions IS NOT NULL
            GROUP BY date, store_nbr
        """,
        "holidays": """
            SELECT date, MAX(is_holiday) AS is_holiday, MAX(is_event) AS is_event,
                   MAX(is_national_event) AS is_national_event,
                   MAX(is_regional_event) AS is_regional_event,
                   MAX(is_local_event) AS is_local_event
            FROM all_data
            GROUP BY date
        """,
        "oil": """
            SELECT date, MAX(oil_price) AS oil_price
            FROM all_data
            WHERE oil_price IS NOT NULL
            GROUP BY date
        """,
    }
    with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as connection:
        return pd.read_sql_query(queries[dataset], connection)


def load_dataset(dataset: str, required: bool = False) -> pd.DataFrame | None:
    path = _find_path(dataset)
    if path is None:
        if required:
            expected = ", ".join(DATASETS[dataset])
            raise HTTPException(
                status_code=503,
                detail=f"Dataset '{dataset}' is unavailable. Add one of these files to backend/data/: {expected}.",
            )
        return None
    if path.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
        return _read_database(dataset, str(path), path.stat().st_mtime_ns)
    return _read_cached(str(path), path.stat().st_mtime_ns)


def _sales_frame() -> pd.DataFrame | None:
    sales = load_dataset("sales")
    if sales is None:
        return None
    frame = sales.copy()
    if "date" not in frame or "unit_sales" not in frame:
        raise HTTPException(
            status_code=422,
            detail="Sales data must include 'date' and 'unit_sales' columns.",
        )
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["unit_sales"] = pd.to_numeric(frame["unit_sales"], errors="coerce").fillna(0)
    frame = frame.dropna(subset=["date"])
    if "family" not in frame and "item_nbr" in frame:
        products = load_dataset("products")
        if products is not None and {"item_nbr", "family"}.issubset(products.columns):
            frame = frame.merge(products[["item_nbr", "family"]].drop_duplicates("item_nbr"), on="item_nbr", how="left")
    return frame


def _filter_sales(
    frame: pd.DataFrame, start: date | str | None, end: date | str | None,
    store: str | None, family: str | None
) -> pd.DataFrame:
    result = frame
    if start:
        result = result[result["date"] >= pd.Timestamp(start)]
    if end:
        result = result[result["date"] <= pd.Timestamp(end) + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)]
    if store and "store_nbr" in result:
        result = result[result["store_nbr"].astype(str) == store]
    if family:
        if "family" not in result:
            return result.iloc[0:0]
        result = result[result["family"].astype(str) == family]
    return result


def _unavailable(reason: str) -> dict[str, Any]:
    return {"available": False, "reason": reason}


def _empty_overview(reason: str) -> dict[str, Any]:
    return {
        **_unavailable(reason),
        "metrics": {
            "total_sales": None,
            "total_transactions": None,
            "active_stores": None,
            "product_count": None,
            "average_daily_demand": None,
        },
        "daily": [],
        "monthly": [],
        "top_families": [],
        "top_stores": [],
        "alerts": [],
        "insights": [],
    }


def _demand_change_alerts(filtered: pd.DataFrame) -> list[dict[str, Any]]:
    latest = filtered.date.max().normalize()
    recent_start = latest - pd.Timedelta(days=6)
    prior_start = latest - pd.Timedelta(days=27)
    result: list[dict[str, Any]] = []
    group_cols = [column for column in ["store_nbr", "family"] if column in filtered]
    grouped: Any = filtered.groupby(group_cols) if group_cols else [((), filtered)]
    for key, group in grouped:
        recent_sales = group[group.date >= recent_start].unit_sales.sum()
        prior_sales = group[(group.date >= prior_start) & (group.date < recent_start)].unit_sales.sum()
        if prior_sales <= 0 or recent_sales / 7 < 1.5 * (prior_sales / 21):
            continue
        values = key if isinstance(key, tuple) else (key,)
        fields = dict(zip(group_cols, values))
        result.append({
            "severity": "medium",
            "store": str(fields["store_nbr"]) if "store_nbr" in fields else "All stores",
            "family": str(fields["family"]) if "family" in fields else "All families",
            "type": "Demand increase",
            "explanation": "Average daily sales over the latest 7 days are at least 50% above the preceding 21-day average.",
            "suggested_action": "Review replenishment needs and verify the change against promotions and calendar events.",
            "timestamp": latest.strftime("%Y-%m-%d"),
        })
    return result


def _overview(start: date | str | None, end: date | str | None, store: str | None, family: str | None) -> dict[str, Any]:
    raw = _sales_frame()
    if raw is None:
        return _empty_overview("Add an aggregated sales dataset to backend/data/ to enable analytics.")
    filtered = _filter_sales(raw, start, end, store, family)
    if filtered.empty:
        return _empty_overview("No sales records match the selected filters.")
    daily = filtered.groupby("date", as_index=False)["unit_sales"].sum().sort_values("date")
    period_start = pd.Timestamp(start).normalize() if start else daily["date"].min().normalize()
    period_end = pd.Timestamp(end).normalize() if end else daily["date"].max().normalize()
    full_dates = pd.date_range(period_start, period_end, freq="D")
    daily = daily.set_index(daily["date"].dt.normalize()).reindex(full_dates, fill_value=0)
    daily.index.name = "date"
    daily["moving_average"] = daily["unit_sales"].rolling(7, min_periods=1).mean()
    daily_records = [
        {"date": date.strftime("%Y-%m-%d"), "sales": round(float(row.unit_sales), 3),
         "moving_average": round(float(row.moving_average), 3)}
        for date, row in daily.iterrows()
    ]
    monthly = (
        filtered.assign(month=filtered["date"].dt.to_period("M").astype(str))
        .groupby("month", as_index=False)["unit_sales"].sum()
        .rename(columns={"unit_sales": "sales"})
    )
    top_families = []
    if "family" in filtered:
        top_families = (
            filtered.groupby("family", as_index=False)["unit_sales"].sum()
            .nlargest(5, "unit_sales").rename(columns={"unit_sales": "sales"})
            .to_dict("records")
        )
    top_stores = []
    if "store_nbr" in filtered:
        top_stores = (
            filtered.groupby("store_nbr", as_index=False)["unit_sales"].sum()
            .nlargest(5, "unit_sales").rename(columns={"store_nbr": "store", "unit_sales": "sales"})
            .to_dict("records")
        )
    calendar_dates = max(1, (period_end - period_start).days + 1)
    transactions = load_dataset("transactions")
    transaction_total: float | None = None
    if transactions is not None and "transactions" in transactions and not family:
        transaction_frame = transactions.copy()
        if "date" in transaction_frame:
            transaction_frame["date"] = pd.to_datetime(transaction_frame["date"], errors="coerce")
            transaction_frame = transaction_frame.dropna(subset=["date"])
            if start:
                transaction_frame = transaction_frame[transaction_frame["date"] >= pd.Timestamp(start)]
            if end:
                transaction_frame = transaction_frame[transaction_frame["date"] < pd.Timestamp(end) + pd.Timedelta(days=1)]
        if store and "store_nbr" in transaction_frame:
            transaction_frame = transaction_frame[transaction_frame["store_nbr"].astype(str) == store]
        transaction_total = float(pd.to_numeric(transaction_frame["transactions"], errors="coerce").fillna(0).sum())

    metrics = {
        "total_sales": round(float(filtered["unit_sales"].sum()), 3),
        "total_transactions": round(transaction_total, 3) if transaction_total is not None else None,
        "active_stores": int(filtered["store_nbr"].nunique()) if "store_nbr" in filtered else None,
        "product_count": int(filtered["item_nbr"].nunique()) if "item_nbr" in filtered else None,
        "average_daily_demand": round(float(filtered["unit_sales"].sum()) / calendar_dates, 3),
    }
    insights: list[str] = []
    if top_families:
        insights.append(f"{top_families[0]['family']} is the highest-volume product family in this selection.")
    if len(daily) >= 14:
        recent = float(daily["unit_sales"].tail(7).mean())
        prior = float(daily["unit_sales"].iloc[-14:-7].mean())
        if prior > 0:
            direction = "increased" if recent >= prior else "decreased"
            pct = abs((recent - prior) / prior * 100)
            insights.append(f"Average daily demand {direction} {pct:.1f}% versus the prior 7-day period.")
    if not insights:
        insights.append("More historical dates are needed to calculate trend-based business insights.")
    recent_alerts = (
        _demand_change_alerts(filtered)
        if filtered.date.dt.normalize().nunique() >= 14 else []
    )
    return {
        "available": True,
        "metrics": metrics,
        "daily": daily_records,
        "monthly": monthly.to_dict("records"),
        "top_families": top_families,
        "top_stores": top_stores,
        "alerts": recent_alerts,
        "insights": insights,
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    sales_path = _find_path("sales")
    sales_available = sales_path is not None
    database_source = sales_path is not None and sales_path.resolve() == DATABASE_PATH.resolve()
    model = model_status()
    training_script = (BASE_DIR.parent / "phase5_model2_3_xgb_lgb.py").is_file()
    date_range = None
    pilot_scope = None
    if database_source:
        with closing(sqlite3.connect(f"file:{DATABASE_PATH.resolve().as_posix()}?mode=ro", uri=True)) as connection:
            first_date, last_date, store_count, family_count = connection.execute(
                "SELECT MIN(date), MAX(date), COUNT(DISTINCT store_nbr), COUNT(DISTINCT family) FROM all_data"
            ).fetchone()
        date_range = {"start": first_date, "end": last_date}
        pilot_scope = {"stores": store_count, "families": family_count}
    return {
        "status": "ok",
        "data_available": sales_available,
        "data_source": "curated store-family SQLite dataset" if database_source else "CSV/Parquet aggregate" if sales_available else None,
        "pilot_scope": pilot_scope,
        "date_range": date_range,
        "model_available": model["available"],
        "model": model,
        "training_script_available": training_script,
        "data_directory": str(DATA_DIR),
        "forecast_status": (
            "ready" if model["available"] else
            "training_script_present_but_model_or_validated_inference_missing" if training_script else
            "missing_model_or_validated_inference_pipeline"
        ),
    }


@app.get("/api/overview")
def overview(
    start: date | None = None, end: date | None = None,
    store: str | None = None, family: str | None = None,
) -> dict[str, Any]:
    return _overview(start, end, store, family)


@app.get("/api/insights")
def insights(
    start: date | None = None, end: date | None = None,
    store: str | None = None, family: str | None = None,
) -> dict[str, Any]:
    result = _overview(start, end, store, family)
    return {"available": result["available"], "reason": result.get("reason"), "insights": result["insights"]}


@app.get("/api/sales/analytics")
def sales_analytics(
    start: date | None = None, end: date | None = None,
    store: str | None = None, family: str | None = None,
) -> dict[str, Any]:
    raw = _sales_frame()
    if raw is None:
        return {**_unavailable("Add a daily sales dataset to backend/data/."), "summary": {}}
    filtered = _filter_sales(raw, start, end, store, family)
    if filtered.empty:
        return {**_unavailable("No sales records match the selected filters."), "summary": {}}
    daily = filtered.groupby("date", as_index=False)["unit_sales"].sum().sort_values("date")
    period_start = pd.Timestamp(start).normalize() if start else daily.date.min().normalize()
    period_end = pd.Timestamp(end).normalize() if end else daily.date.max().normalize()
    days = pd.date_range(period_start, period_end, freq="D")
    daily = daily.set_index(daily.date.dt.normalize()).reindex(days, fill_value=0)
    daily.index.name = "date"
    daily["moving_average"] = daily.unit_sales.rolling(7, min_periods=1).mean()
    date_totals = filtered.groupby(filtered.date.dt.normalize()).unit_sales.sum()
    date_totals = date_totals.reindex(days, fill_value=0)
    weekday = date_totals.groupby(date_totals.index.day_name()).mean()
    weekday_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    response_daily = [
        {"date": date.strftime("%Y-%m-%d"), "sales": round(float(row.unit_sales), 3),
         "moving_average": round(float(row.moving_average), 3)}
        for date, row in daily.iterrows()
    ]
    monthly = filtered.assign(month=filtered.date.dt.to_period("M").astype(str)).groupby("month", as_index=False).unit_sales.sum().rename(columns={"unit_sales": "sales"})
    weekly = (
        filtered.assign(week=filtered.date.dt.to_period("W-SUN").dt.start_time)
        .groupby("week", as_index=False).unit_sales.sum()
        .rename(columns={"unit_sales": "sales"})
    )
    weekly["week"] = weekly["week"].dt.strftime("%Y-%m-%d")
    holiday = load_dataset("holidays")
    holiday_result: list[dict[str, Any]] = []
    if holiday is not None and "is_holiday" in holiday:
        events = holiday.copy()
        events["date"] = pd.to_datetime(events.date, errors="coerce")
        event_dates = set(events.loc[pd.to_numeric(events.is_holiday, errors="coerce").fillna(0) > 0, "date"].dropna().dt.normalize())
        compared = date_totals.groupby(date_totals.index.normalize().isin(event_dates)).mean()
        holiday_result = [{"group": "Holiday date" if bool(flag) else "Non-holiday date", "average_sales": round(float(value), 3)} for flag, value in compared.items()]
    elif holiday is not None and {"date", "type"}.issubset(holiday.columns):
        events = holiday.copy()
        events["date"] = pd.to_datetime(events.date, errors="coerce")
        event_dates = set(events.dropna(subset=["date"]).date.dt.normalize())
        compared = date_totals.groupby(date_totals.index.normalize().isin(event_dates)).mean()
        holiday_result = [{"group": "Event date" if bool(flag) else "Non-event date", "average_sales": round(float(value), 3)} for flag, value in compared.items()]
    event_names = {
        "is_national_event": "National",
        "is_regional_event": "Regional",
        "is_local_event": "Local",
    }
    event_impact = []
    event_columns = [column for column in event_names if column in filtered]
    if event_columns:
        event_flags = filtered.groupby(filtered.date.dt.normalize())[event_columns].max().reindex(days, fill_value=0)
        for column, label in event_names.items():
            if column not in event_flags:
                continue
            flags = pd.to_numeric(event_flags[column], errors="coerce").fillna(0) > 0
            event_impact.append({
                "event": label,
                "event_sales": round(float(date_totals[flags].mean()), 3) if flags.any() else None,
                "non_event_sales": round(float(date_totals[~flags].mean()), 3) if (~flags).any() else None,
            })
    summary: dict[str, Any] = {
        "total_units": round(float(filtered.unit_sales.sum()), 3),
        "average_daily_units": round(float(filtered.unit_sales.sum()) / max(1, (period_end - period_start).days + 1), 3),
        "date_count": int(filtered.date.dt.normalize().nunique()),
    }
    if "transactions" in filtered and "store_nbr" not in filtered:
        summary["transactions"] = round(float(pd.to_numeric(filtered.transactions, errors="coerce").fillna(0).sum()), 3)
    oil_scatter: list[dict[str, float]] = []
    oil = load_dataset("oil")
    if oil is not None and {"date", "oil_price"}.issubset(oil.columns):
        oil = oil.copy()
        oil["date"] = pd.to_datetime(oil.date, errors="coerce").dt.normalize()
        oil["oil_price"] = pd.to_numeric(oil.oil_price, errors="coerce")
        daily_units = filtered.groupby(filtered.date.dt.normalize()).unit_sales.sum().rename("sales")
        joined_oil = daily_units.to_frame().join(oil.dropna(subset=["date"]).drop_duplicates("date").set_index("date").oil_price, how="inner").dropna()
        oil_scatter = [{"oil_price": round(float(row.oil_price), 4), "sales": round(float(row.sales), 3)} for row in joined_oil.itertuples()]
    transaction_scatter: list[dict[str, float]] = []
    transaction_data = load_dataset("transactions")
    if transaction_data is not None and "transactions" in transaction_data and not family:
        tx = transaction_data.copy()
        tx["date"] = pd.to_datetime(tx["date"], errors="coerce").dt.normalize()
        if store and "store_nbr" in tx:
            tx = tx[tx.store_nbr.astype(str) == store]
        tx_by_date = tx.dropna(subset=["date"]).groupby("date").transactions.sum().rename("transactions")
        units_by_date = filtered.groupby(filtered.date.dt.normalize()).unit_sales.sum().rename("sales")
        joined_tx = units_by_date.to_frame().join(tx_by_date, how="inner").dropna()
        transaction_scatter = [{"transactions": round(float(row.transactions), 3), "sales": round(float(row.sales), 3)} for row in joined_tx.itertuples()]
    return {
        "available": True, "summary": summary, "daily": response_daily,
        "monthly": monthly.to_dict("records"),
        "weekly": weekly.to_dict("records"),
        "weekday": [{"weekday": day, "average_sales": round(float(weekday[day]), 3)} for day in weekday_order if day in weekday],
        "holiday": holiday_result,
        "event_impact": event_impact,
        "oil_scatter": oil_scatter,
        "transaction_scatter": transaction_scatter,
    }


@app.get("/api/products/analytics")
def products_analytics(
    start: date | None = None, end: date | None = None,
    store: str | None = None, family: str | None = None,
) -> dict[str, Any]:
    raw = _sales_frame()
    if raw is None:
        return {**_unavailable("Add sales and item metadata to backend/data/."), "summary": {}}
    filtered = _filter_sales(raw, start, end, store, family)
    if filtered.empty:
        return {**_unavailable("No sales records match the selected filters."), "summary": {}}
    if "family" not in filtered:
        return {**_unavailable("Product family analysis requires items.csv with item_nbr and family columns."), "summary": {}}
    family_demand = filtered.groupby("family").unit_sales.sum().rename("demand")
    daily_demand = filtered.groupby(["family", filtered.date.dt.normalize()]).unit_sales.sum()
    period_start = pd.Timestamp(start).normalize() if start else filtered.date.min().normalize()
    period_end = pd.Timestamp(end).normalize() if end else filtered.date.max().normalize()
    daily_dates = pd.date_range(period_start, period_end, freq="D")
    variability: dict[str, float | None] = {}
    for product_family in filtered.family.dropna().unique():
        try:
            family_series = daily_demand.xs(product_family, level="family").reindex(daily_dates, fill_value=0)
        except KeyError:
            family_series = pd.Series(0, index=daily_dates)
        value = family_series.std()
        variability[str(product_family)] = float(value) if pd.notna(value) else None
    item_counts = (
        filtered.groupby("family").item_nbr.nunique().rename("item_count")
        if "item_nbr" in filtered else pd.Series(index=family_demand.index, dtype="Int64", name="item_count")
    )
    grouped = family_demand.to_frame().join(item_counts).reset_index()
    grouped["daily_std"] = grouped["family"].astype(str).map(variability)
    products = load_dataset("products")
    if "has_perishable" in filtered:
        perishable_units = float(filtered.loc[pd.to_numeric(filtered.has_perishable, errors="coerce").fillna(0) > 0, "unit_sales"].sum())
    elif products is not None and {"item_nbr", "perishable"}.issubset(products.columns) and "item_nbr" in filtered:
        perishable_items = set(products.loc[pd.to_numeric(products.perishable, errors="coerce").fillna(0) > 0, "item_nbr"])
        perishable_units = float(filtered.loc[filtered.item_nbr.isin(perishable_items), "unit_sales"].sum())
    else:
        perishable_units = None
    grouped = grouped.sort_values("demand", ascending=False)
    return {
        "available": True,
        "summary": {
            "total_units": round(float(filtered.unit_sales.sum()), 3),
            "family_count": int(filtered.family.nunique()),
            "perishable_units": round(perishable_units, 3) if perishable_units is not None else None,
        },
        "families": [
            {"family": str(row.family), "demand": round(float(row.demand), 3),
             "daily_std": round(float(row.daily_std), 3) if pd.notna(row.daily_std) else None,
             "items": int(row.item_count) if pd.notna(row.item_count) else None}
            for row in grouped.itertuples(index=False)
        ],
    }


@app.get("/api/stores/analytics")
def stores_analytics(
    start: date | None = None, end: date | None = None,
    store: str | None = None, family: str | None = None,
) -> dict[str, Any]:
    raw = _sales_frame()
    if raw is None:
        return {**_unavailable("Add a daily sales dataset to backend/data/."), "summary": {}}
    filtered = _filter_sales(raw, start, end, store, family)
    if filtered.empty or "store_nbr" not in filtered:
        return {**_unavailable("Store analysis requires matching sales with a store_nbr column."), "summary": {}}
    grouped = filtered.groupby("store_nbr", as_index=False).agg(units=("unit_sales", "sum"), active_days=("date", "nunique"))
    transactions = load_dataset("transactions")
    if transactions is not None and {"store_nbr", "transactions"}.issubset(transactions.columns):
        tx = transactions.copy()
        if "date" in tx:
            tx.date = pd.to_datetime(tx.date, errors="coerce")
            if start:
                tx = tx[tx.date >= pd.Timestamp(start)]
            if end:
                tx = tx[tx.date < pd.Timestamp(end) + pd.Timedelta(days=1)]
        tx = tx.groupby("store_nbr", as_index=False).transactions.sum()
        grouped = grouped.merge(tx, on="store_nbr", how="left")
        grouped["efficiency"] = grouped["units"] / grouped["transactions"].replace(0, pd.NA)
    else:
        grouped["transactions"] = pd.NA
        grouped["efficiency"] = pd.NA
    store_data = load_dataset("stores")
    if store_data is not None and "store_nbr" in store_data:
        dimensions = [column for column in ["store_nbr", "city", "state", "store_type", "cluster"] if column in store_data]
        grouped = grouped.merge(store_data[dimensions].drop_duplicates("store_nbr"), on="store_nbr", how="left")
    grouped = grouped.sort_values("units", ascending=False)
    daily_trend = filtered.groupby(filtered.date.dt.normalize()).unit_sales.sum()
    trend_records = [
        {"date": day.strftime("%Y-%m-%d"), "units": round(float(value), 3)}
        for day, value in daily_trend.items()
    ]
    type_performance: list[dict[str, Any]] = []
    city_performance: list[dict[str, Any]] = []
    if store_data is not None and "store_type" in store_data:
        by_store = filtered.groupby("store_nbr").unit_sales.sum().rename("units").reset_index()
        joined = by_store.merge(store_data[["store_nbr", "store_type"]].drop_duplicates("store_nbr"), on="store_nbr", how="left")
        type_performance = joined.groupby("store_type", as_index=False).agg(units=("units", "sum"), stores=("store_nbr", "nunique")).to_dict("records")
    if store_data is not None and "city" in store_data:
        by_store = filtered.groupby("store_nbr").unit_sales.sum().rename("units").reset_index()
        joined = by_store.merge(store_data[["store_nbr", "city"]].drop_duplicates("store_nbr"), on="store_nbr", how="left")
        city_performance = (
            joined.dropna(subset=["city"])
            .groupby("city", as_index=False)
            .agg(units=("units", "sum"), stores=("store_nbr", "nunique"))
            .sort_values("units", ascending=False)
            .to_dict("records")
        )
    return {
        "available": True,
        "summary": {"store_count": int(grouped.store_nbr.nunique()), "total_units": round(float(grouped.units.sum()), 3)},
        "daily_trend": trend_records,
        "store_types": type_performance,
        "cities": city_performance,
        "stores": [
            {"store": str(row.store_nbr), "units": round(float(row.units), 3),
             "transactions": round(float(row.transactions), 3) if pd.notna(row.transactions) else None,
             "efficiency": round(float(row.efficiency), 3) if pd.notna(row.efficiency) else None,
             "active_days": int(row.active_days),
             "city": str(row.city) if hasattr(row, "city") and pd.notna(row.city) else None,
             "state": str(row.state) if hasattr(row, "state") and pd.notna(row.state) else None,
             "store_type": str(row.store_type) if hasattr(row, "store_type") and pd.notna(row.store_type) else None,
             "cluster": int(row.cluster) if hasattr(row, "cluster") and pd.notna(row.cluster) else None}
            for row in grouped.itertuples(index=False)
        ],
    }


@app.post("/api/forecast")
def forecast(request: ForecastRequest) -> dict[str, Any]:
    try:
        return forecast_series(
            request.store, request.family, request.horizon_days, request.as_of_date,
            [event.model_dump() for event in request.future_events], request.assume_no_unlisted_events,
        )
    except ForecastPipelineError as error:
        status_code = 503 if error.code in {"MODEL_ARTIFACT_MISSING", "REFERENCE_PREDICTION_FAILED"} else 422
        raise HTTPException(
            status_code=status_code,
            detail={"code": error.code, "message": str(error), "details": error.details},
        ) from error


@app.post("/api/inventory/calculate")
def calculate_inventory(request: InventoryRequest) -> dict[str, Any]:
    z_score = NormalDist().inv_cdf(request.service_level)
    lead_time_demand = request.average_daily_demand * request.lead_time_days
    safety_stock = ceil(z_score * request.daily_demand_std * sqrt(request.lead_time_days))
    reorder_point = ceil(lead_time_demand + safety_stock)
    coverage_days = (
        (request.on_hand + request.incoming - request.backorders) / request.average_daily_demand
        if request.average_daily_demand > 0 else None
    )
    target_days = request.lead_time_days + request.review_period_days
    target_stock = ceil(request.average_daily_demand * target_days + safety_stock)
    if request.shelf_life_days is not None:
        target_stock = min(target_stock, ceil(request.average_daily_demand * request.shelf_life_days))
    position = request.on_hand + request.incoming - request.backorders
    return {
        "safety_stock": safety_stock,
        "reorder_point": reorder_point,
        "inventory_position": round(position, 3),
        "target_stock": target_stock,
        "suggested_order_quantity": max(0, ceil(target_stock - position)),
        "inventory_coverage_days": round(coverage_days, 2) if coverage_days is not None else None,
        "assumptions": [
            "Safety stock uses the normal-approximation method: z(service level) × daily demand standard deviation × √lead time.",
            "Demand variability is assumed independent across days; use a calibrated forecast-error series where available.",
            "Inventory position is on-hand + incoming − backorders. This is a planning estimate, not a purchase order.",
        ],
    }


@app.get("/api/inventory/demand-stats")
def inventory_demand_stats(
    store: int, family: str, lookback_days: int = Query(default=90, ge=14, le=365),
) -> dict[str, Any]:
    raw = _sales_frame()
    if raw is None:
        raise HTTPException(status_code=503, detail="Historical sales data is unavailable.")
    filtered = _filter_sales(raw, None, None, str(store), family)
    if filtered.empty:
        raise HTTPException(status_code=404, detail="No historical demand exists for the selected store and family.")
    end = filtered["date"].max().normalize()
    start = end - pd.Timedelta(days=lookback_days - 1)
    calendar = pd.date_range(start, end, freq="D")
    daily = (
        filtered.loc[filtered["date"].between(start, end)]
        .groupby(filtered.loc[filtered["date"].between(start, end), "date"].dt.normalize())["unit_sales"]
        .sum()
        .reindex(calendar, fill_value=0.0)
        .astype(float)
    )
    if len(daily) < 2:
        raise HTTPException(status_code=422, detail="At least two daily observations are required.")
    return {
        "store": store,
        "family": family,
        "lookback_days": lookback_days,
        "period": {"start": start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d")},
        "average_daily_demand": round(float(daily.mean()), 3),
        "daily_demand_std": round(float(daily.std(ddof=1)), 3),
        "method": "Sample standard deviation of calendar-day demand; missing dates are treated as zero demand.",
    }


@app.get("/api/alerts")
def alerts(
    start: date | None = None, end: date | None = None, store: str | None = None,
    family: str | None = None, severity: str | None = None, type: str | None = None,
) -> dict[str, Any]:
    raw = _sales_frame()
    if raw is None:
        return {**_unavailable("Demand-change alerts require sales data. Inventory alerts require inventory records."), "alerts": []}
    filtered = _filter_sales(raw, start, end, store, family)
    if filtered.empty or len(filtered.date.dt.normalize().unique()) < 14:
        return {**_unavailable("At least 14 days of matching sales history are required for demand-change monitoring."), "alerts": []}
    alerts_result = _demand_change_alerts(filtered)
    if severity:
        alerts_result = [alert for alert in alerts_result if alert["severity"] == severity.lower()]
    if type:
        alerts_result = [alert for alert in alerts_result if type.lower() in alert["type"].lower()]
    return {"available": True, "alerts": alerts_result, "threshold": "50% increase against previous 21-day daily average"}


@app.get("/api/data")
def explore_data(
    dataset: str = Query(...), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=500),
    search: str | None = None, sort: str | None = None, order: str = Query("asc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    if dataset not in DATASETS:
        raise HTTPException(status_code=400, detail=f"Unsupported dataset. Choose from: {', '.join(DATASETS)}.")
    frame = load_dataset(dataset)
    if frame is None:
        expected = ", ".join(DATASETS[dataset])
        return {
            **_unavailable(f"No {dataset} data found. Add one of these files under backend/data/: {expected}."),
            "columns": [], "records": [], "total": 0, "page": page, "page_size": page_size, "missing": {},
        }
    columns = [str(column) for column in frame.columns]
    missing = {str(column): int(count) for column, count in frame.isna().sum().items()}
    if search:
        mask = frame.astype("string").apply(lambda col: col.str.contains(search, case=False, na=False, regex=False)).any(axis=1)
        frame = frame.loc[mask]
    if sort:
        if sort not in frame.columns:
            raise HTTPException(status_code=400, detail=f"Unknown sort column '{sort}'.")
        frame = frame.sort_values(sort, ascending=order == "asc", na_position="last")
    total = len(frame)
    page_frame = frame.iloc[(page - 1) * page_size:page * page_size]
    records = page_frame.astype(object).where(pd.notna(page_frame), None).to_dict("records")
    return {
        "available": True, "columns": columns, "records": records, "total": total,
        "page": page, "page_size": page_size, "missing": missing,
    }
