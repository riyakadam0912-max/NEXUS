# NEXUS — FMCG Demand Intelligence

Responsive React + FastAPI demo for historical sales analytics, product/store analysis, demand planning, inventory calculations, risk monitoring, and paginated data exploration.

## Current workspace status

The workspace provides `FMCG_Modelling_Dataset.db`, a curated store-family dataset with 379,800 daily rows covering 15 stores and 15 product families. The API reads it read-only and derives sales, store/product dimensions, transaction totals, holiday indicators, and oil prices from its `all_data` table. It is an aggregated pilot dataset, not item-level transaction history or the complete 125-million-row Favorita source. The UI and API do **not** invent metrics or forecast predictions.

The workspace includes the native LightGBM booster, authoritative inference configuration, feature-generation code, encoders, and evaluation metadata. The FastAPI service validates the model contract and supplied reference prediction at startup, then performs recursive daily inference at the store-product-family level. Inventory estimates can consume the generated forecast while continuing to require explicit stock and variability inputs.

The local environment used for initial validation has Node.js 24 and Python 3.13. The requested Python 3.12 is not installed; use Python 3.12 for the intended environment if available.

## Run locally

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). The Vite development server proxies `/api` requests to `http://127.0.0.1:8000`. Set `VITE_API_URL` in the frontend environment only when using a different API origin during development.

## Data setup

The checked-in workspace database is discovered automatically and opened read-only. To use CSV or Parquet sources instead, place them under `backend/data/`. The preferred sales input is a filtered daily aggregate named `sales_daily.parquet` with at least:

| Column | Meaning |
|---|---|
| `date` | Calendar date |
| `unit_sales` | Units sold for the row |
| `store_nbr` | Store identifier |
| `item_nbr` | Product identifier, when available |
| `family` | Optional if `items.csv` provides item-to-family mapping |

Supported sources include `stores.csv`, `items.csv` or `products.csv`, `transactions.csv`, `holidays_events.csv`, `oil.csv`, `inventory.csv`, and `forecast_results.parquet`. The data explorer reports missing datasets explicitly. The current SQLite source contains family-level sales and perishable-family metadata only; it cannot provide individual item counts or item-level analytics. Raw CSV files above 250 MB are rejected to avoid loading a huge Favorita source into memory; use a pre-aggregated Parquet file instead. For transaction KPIs, provide a separate store/date transactions dataset so item-level sales joins cannot duplicate transaction totals.

## Inventory calculation

The calculator uses `safety stock = z(service level) × daily demand standard deviation × √lead time`. Reorder point is lead-time demand plus safety stock. Inventory position is on-hand plus incoming minus backorders. The target stock covers lead time plus review period, capped by shelf-life demand when supplied. This is a transparent planning estimate; it does not create purchase orders or claim current stock data.

## API

- `GET /api/health`
- `GET /api/overview`
- `GET /api/sales/analytics`
- `GET /api/products/analytics`
- `GET /api/stores/analytics`
- `POST /api/forecast`
- `POST /api/inventory/calculate`
- `GET /api/alerts`
- `GET /api/data`
- `GET /api/insights`

Analytics accept optional `start`, `end`, `store`, and `family` query parameters. All page navigation and API-backed data exploration are implemented. Dataset and model availability are surfaced in the interface instead of being replaced with demo metrics.

## Production deployment

Deploy `frontend/` to Vercel and the FastAPI app to Render. The frontend uses same-origin `/api` requests in production; `frontend/vercel.json` proxies those requests to `https://nexus-api1-3arj.onrender.com` before applying the SPA fallback. This avoids browser CORS configuration for the Vercel app. No `VITE_API_URL` setting is needed in Vercel; the production build intentionally ignores it. Keep `PRODUCTION_CORS_ORIGINS` configured on Render only if browser clients need to call the Render URL directly.
# LightGBM forecasting

The forecast API uses the supplied native LightGBM booster and its 56-feature contract. Runtime artifacts default to the project root and can be overridden with `NEXUS_LGB_MODEL`, `NEXUS_LGB_CONFIG`, and `NEXUS_DATABASE`.

The model forecasts daily demand at the store–product-family level from the historical origin `2017-08-15`. Supported horizons are 1–76 days. Future holiday/event coverage must be supplied with the request, or the caller must explicitly set `assume_no_unlisted_events` to `true`; the API never silently invents future calendar information. Oil is forward-filled, transactions use training-period store-weekday medians, and recursive predictions feed subsequent sales lag and rolling features.

Install and start:

```powershell
cd C:\Users\91773\NEXUS
pip install -r backend\requirements.txt
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
cd C:\Users\91773\NEXUS
npm run dev
```

The health response reports model readiness, artifact hash, runtime version, feature/tree counts, validated horizon, and reference-prediction error. Inventory Planning accepts forecast average demand but continues to require explicit stock, lead-time, and demand-uncertainty inputs.
