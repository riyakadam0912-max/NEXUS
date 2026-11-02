import sqlite3
from datetime import date, timedelta

import pandas as pd
from fastapi.testclient import TestClient

from main import DATABASE_PATH, _demand_change_alerts, _sales_frame, app


client = TestClient(app)


def test_database_sales_frame_is_compact_and_reused() -> None:
    frame = _sales_frame()
    assert frame is not None
    assert _sales_frame() is frame
    assert pd.api.types.is_datetime64_any_dtype(frame["date"])
    assert isinstance(frame["family"].dtype, pd.CategoricalDtype)
    assert frame.memory_usage(deep=True).sum() < 50 * 1024 * 1024


def test_demand_change_alerts_compare_recent_and_prior_group_totals() -> None:
    latest = date(2024, 1, 28)
    rows = []
    for day_offset in range(28):
        day = latest - timedelta(days=27 - day_offset)
        for store, recent_sales in [(2, 20), (3, 10)]:
            rows.append({
                "date": pd.Timestamp(day),
                "store_nbr": store,
                "family": "BEVERAGES",
                "unit_sales": recent_sales if day_offset >= 21 else 10,
            })

    alerts = _demand_change_alerts(pd.DataFrame(rows))

    assert [(alert["store"], alert["family"]) for alert in alerts] == [("2", "BEVERAGES")]


def test_health_reports_real_source_and_model_state() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["data_available"] is True
    assert payload["model_available"] is True
    assert payload["model"]["features"] == 56
    assert payload["model"]["trees"] == 379


def test_sales_analytics_has_daily_weekly_and_monthly_series() -> None:
    response = client.get(
        "/api/sales/analytics",
        params={"start": "2017-08-01", "end": "2017-08-15", "store": "44"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is True
    assert len(payload["daily"]) == 15
    assert payload["weekly"]
    assert payload["monthly"]


def test_transactions_are_not_duplicated_by_family_rows() -> None:
    overview = client.get(
        "/api/overview",
        params={"start": "2017-08-01", "end": "2017-08-15", "store": "44"},
    ).json()
    with sqlite3.connect(DATABASE_PATH) as connection:
        expected = connection.execute(
            """
            SELECT SUM(transactions) FROM (
                SELECT date, store_nbr, MAX(transactions) AS transactions
                FROM all_data
                WHERE store_nbr = 44 AND date BETWEEN '2017-08-01' AND '2017-08-15'
                GROUP BY date, store_nbr
            )
            """
        ).fetchone()[0]
    assert overview["metrics"]["total_transactions"] == expected


def test_family_aggregate_does_not_claim_item_counts() -> None:
    response = client.get(
        "/api/products/analytics",
        params={"start": "2017-08-01", "end": "2017-08-15", "store": "44"},
    )
    assert response.status_code == 200
    assert all(row["items"] is None for row in response.json()["families"])


def test_inventory_calculation_uses_transparent_position_formula() -> None:
    response = client.post(
        "/api/inventory/calculate",
        json={
            "average_daily_demand": 10,
            "daily_demand_std": 2,
            "on_hand": 25,
            "incoming": 10,
            "backorders": 5,
            "lead_time_days": 4,
            "review_period_days": 3,
            "service_level": 0.95,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["inventory_position"] == 30
    assert payload["safety_stock"] == 7
    assert payload["reorder_point"] == 47
    assert payload["target_stock"] == 77
    assert payload["suggested_order_quantity"] == 47


def test_inventory_demand_variability_is_calculated_from_history() -> None:
    response = client.get(
        "/api/inventory/demand-stats",
        params={"store": 44, "family": "GROCERY I", "lookback_days": 90},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["lookback_days"] == 90
    assert payload["average_daily_demand"] > 0
    assert payload["daily_demand_std"] > 0
    assert payload["period"] == {"start": "2017-05-18", "end": "2017-08-15"}


def test_forecast_requires_explicit_future_calendar_policy() -> None:
    response = client.post(
        "/api/forecast",
        json={"store": 44, "family": "GROCERY I", "horizon_days": 7},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INCOMPLETE_FUTURE_CALENDAR"


def test_lightgbm_forecast_returns_recursive_daily_predictions() -> None:
    response = client.post(
        "/api/forecast",
        json={
            "store": 44,
            "family": "GROCERY I",
            "horizon_days": 7,
            "assume_no_unlisted_events": True,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["forecast"]) == 7
    assert payload["model"]["lightgbm_runtime_version"] == "4.7.0"
    assert payload["metrics"]["total_predicted_demand"] > 0
    assert all(point["prediction"] >= 0 for point in payload["forecast"])


def test_forecast_rejects_unsupported_horizon() -> None:
    response = client.post(
        "/api/forecast",
        json={
            "store": 44,
            "family": "GROCERY I",
            "horizon_days": 77,
            "assume_no_unlisted_events": True,
        },
    )
    assert response.status_code == 422


def test_forecast_rejects_event_outside_requested_window() -> None:
    response = client.post(
        "/api/forecast",
        json={
            "store": 44,
            "family": "GROCERY I",
            "horizon_days": 7,
            "assume_no_unlisted_events": True,
            "future_events": [{"date": "2017-08-23", "is_holiday": 1}],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "EVENT_DATE_OUT_OF_RANGE"


def test_forecast_is_deterministic_and_request_independent() -> None:
    request = {
        "store": 44,
        "family": "GROCERY I",
        "horizon_days": 7,
        "assume_no_unlisted_events": True,
    }
    first = client.post("/api/forecast", json=request)
    client.post(
        "/api/forecast",
        json={**request, "store": 45, "family": "BEVERAGES"},
    )
    second = client.post("/api/forecast", json=request)
    assert first.status_code == second.status_code == 200
    assert first.json()["forecast"] == second.json()["forecast"]
