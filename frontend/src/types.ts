export type Metric = {
  label: string;
  value: number | null;
  change: number | null;
};

export type OverviewData = {
  available: boolean;
  reason?: string;
  metrics: {
    total_sales: number | null;
    total_transactions: number | null;
    active_stores: number | null;
    product_count: number | null;
    average_daily_demand: number | null;
  };
  daily: Array<{ date: string; sales: number; moving_average: number | null }>;
  monthly: Array<{ month: string; sales: number }>;
  top_families: Array<{ family: string; sales: number }>;
  top_stores: Array<{ store: string; sales: number }>;
  alerts: Array<{
    severity: string;
    store: string;
    family: string;
    type: string;
    explanation: string;
    suggested_action: string;
    timestamp: string;
  }>;
  insights: string[];
};

export type AnalyticsResponse = {
  available: boolean;
  reason?: string;
  summary: Record<string, number | string | null>;
  daily?: Array<Record<string, string | number | null>>;
  monthly?: Array<Record<string, string | number | null>>;
  weekly?: Array<Record<string, string | number | null>>;
  weekday?: Array<Record<string, string | number | null>>;
  families?: Array<Record<string, string | number | null>>;
  stores?: Array<Record<string, string | number | null>>;
  products?: Array<Record<string, string | number | null>>;
  scatter?: Array<Record<string, string | number | null>>;
  holiday?: Array<{ group: string; average_sales: number }>;
  event_impact?: Array<{ event: string; event_sales: number | null; non_event_sales: number | null }>;
  oil_scatter?: Array<{ oil_price: number; sales: number }>;
  transaction_scatter?: Array<{ transactions: number; sales: number }>;
  daily_trend?: Array<{ date: string; units: number }>;
  store_types?: Array<{ store_type: string; units: number; stores: number }>;
  cities?: Array<{ city: string; units: number; stores: number }>;
  records?: Array<Record<string, unknown>>;
};

export type ApiDataset = {
  available: boolean;
  reason?: string;
  columns: string[];
  records: Array<Record<string, unknown>>;
  total: number;
  page: number;
  page_size: number;
  missing: Record<string, number>;
};

export type GlobalFilters = {
  start?: string;
  end?: string;
  store?: string;
  family?: string;
};

export type ForecastResponse = {
  available: true;
  model: { name: string; artifact_hash: string; lightgbm_runtime_version: string; best_iteration: number; validated_horizon_days: number; reference_error: number };
  selection: { store: number; family: string; origin: string; horizon_days: number };
  forecast_range: { start: string; end: string };
  historical: Array<{ date: string; actual: number }>;
  forecast: Array<{ date: string; prediction: number; step: number }>;
  metrics: { total_predicted_demand: number; average_daily_demand: number; peak_demand: number; peak_date: string };
  evaluation: Record<string, number | string>;
  assumptions: string[];
};
