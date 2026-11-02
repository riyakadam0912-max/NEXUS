import axios from "axios";
import type { AnalyticsResponse, ApiDataset, ForecastResponse, GlobalFilters, OverviewData } from "../types";

const productionApiUrl = "https://nexus-api1-3arj.onrender.com";
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL?.trim() || productionApiUrl,
});

function filterParams(filters: GlobalFilters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}

export async function getOverview(filters: GlobalFilters) {
  const { data } = await client.get<OverviewData>("/api/overview", { params: filterParams(filters) });
  return data;
}

export async function getAnalytics(
  section: "sales" | "products" | "stores",
  filters: GlobalFilters,
) {
  const { data } = await client.get<AnalyticsResponse>(`/api/${section}/analytics`, {
    params: filterParams(filters),
  });
  return data;
}

export async function getDataset(
  dataset: string,
  options: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string } = {},
) {
  const { data } = await client.get<ApiDataset>("/api/data", {
    params: {
      dataset,
      page: options.page ?? 1,
      page_size: options.pageSize ?? 25,
      search: options.search,
      sort: options.sort,
      order: options.order,
    },
  });
  return data;
}

export async function getAlerts(filters: GlobalFilters & { severity?: string; type?: string }) {
  const { data } = await client.get("/api/alerts", { params: filterParams(filters) });
  return data as { available: boolean; reason?: string; alerts: Array<Record<string, unknown>> };
}

export async function getHealth() {
  const { data } = await client.get("/api/health");
  return data as {
    status: string;
    data_available: boolean;
    model_available: boolean;
    model?: Record<string, unknown>;
    training_script_available?: boolean;
    data_source?: string | null;
    pilot_scope?: { stores: number; families: number } | null;
    date_range?: { start: string; end: string } | null;
  };
}

export async function getForecast(store: string, family: string, horizonDays: number, assumeNoUnlistedEvents: boolean) {
  const { data } = await client.post<ForecastResponse>("/api/forecast", {
    store: Number(store), family, horizon_days: horizonDays,
    assume_no_unlisted_events: assumeNoUnlistedEvents,
  });
  return data;
}

export async function calculateInventory(input: {
  average_daily_demand: number;
  daily_demand_std: number;
  on_hand: number;
  incoming: number;
  backorders: number;
  lead_time_days: number;
  review_period_days: number;
  service_level: number;
  shelf_life_days?: number;
}) {
  const { data } = await client.post("/api/inventory/calculate", input);
  return data as {
    safety_stock: number;
    reorder_point: number;
    inventory_position: number;
    target_stock: number;
    suggested_order_quantity: number;
    inventory_coverage_days: number | null;
    assumptions: string[];
  };
}

export async function getInventoryDemandStats(store: string, family: string, lookbackDays = 90) {
  const { data } = await client.get("/api/inventory/demand-stats", {
    params: { store: Number(store), family, lookback_days: lookbackDays },
  });
  return data as {
    store: number;
    family: string;
    lookback_days: number;
    period: { start: string; end: string };
    average_daily_demand: number;
    daily_demand_std: number;
    method: string;
  };
}
