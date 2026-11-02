import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";
import {
  AlertCircle, Boxes, CheckCircle2, Download, FileSpreadsheet, RefreshCw,
  Search, ShoppingCart, Sparkles, Store, TrendingUp, Package, Activity,
  UploadCloud, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Line, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip,
  XAxis, YAxis,
} from "recharts";
import type { AnalyticsResponse, ApiDataset, ForecastResponse, GlobalFilters, OverviewData } from "../types";
import { calculateInventory, getAlerts, getAnalytics, getDataset, getForecast, getInventoryDemandStats, getOverview } from "../services/api";
import { Button } from "../components/ui/button";

const VIOLET = "#8b5cf6";
const COLORS = ["#8b5cf6", "#5fe1b2", "#f5b544", "#60a5fa", "#fb7185", "#a78bfa"];
const axis = { fill: "#73809a", fontSize: 10 };

function useResource<T>(load: () => Promise<T>, dependencies: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    load().then((result) => { if (active) setData(result); })
      .catch((reason: unknown) => {
        if (!active) return;
        const message = (reason as { response?: { data?: { detail?: unknown } }; message?: string })?.response?.data?.detail;
        setError(typeof message === "string" ? message : typeof message === "object" && message && "message" in message ? String(message.message) : "Unable to reach the analytics API. Check that FastAPI is running.");
        setData(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Loaders are intentionally keyed by the explicit dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, attempt]);
  return { data, loading, error, retry: () => setAttempt((value) => value + 1) };
}

function fmt(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function PageIntro({ eyebrow, title, description, right }: { eyebrow: string; title: string; description: string; right?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-violet-300">{eyebrow}</p><h2 className="font-[Manrope] text-[24px] font-bold tracking-tight text-slate-100">{title}</h2><p className="mt-1 max-w-[740px] text-[12px] leading-relaxed text-slate-400">{description}</p></div>{right}</div>;
}

function Panel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`surface min-w-0 rounded-xl p-4 sm:p-5 ${className}`}><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-[12px] font-semibold text-slate-100">{title}</h3>{subtitle && <p className="mt-1 text-[10px] text-slate-500">{subtitle}</p>}</div>{action}</div>{children}</section>;
}

function MetricCard({ label, value, note, icon: Icon, tone = "violet" }: { label: string; value: string; note: string; icon: typeof Activity; tone?: string }) {
  const tones: Record<string, string> = { violet: "bg-violet-400/10 text-violet-300", green: "bg-emerald-400/10 text-emerald-300", amber: "bg-amber-400/10 text-amber-300", blue: "bg-blue-400/10 text-blue-300" };
  return <div className="surface rounded-xl p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium text-slate-400">{label}</p><div className="mt-2 font-[Manrope] text-[23px] font-bold tracking-tight text-slate-100">{value}</div></div><div className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone] ?? tones.violet}`}><Icon size={16} /></div></div><p className="mt-2 text-[10px] text-slate-500">{note}</p></div>;
}

function DataState({ loading, error, reason, retry }: { loading?: boolean; error?: string; reason?: string; retry?: () => void }) {
  if (loading) return <div className="grid min-h-[190px] place-items-center"><div className="flex items-center gap-2 text-[11px] text-slate-400"><RefreshCw size={14} className="animate-spin" /> Loading verified source data…</div></div>;
  if (!error && !reason) return null;
  return <div className="grid min-h-[190px] place-items-center px-5 text-center"><div className="max-w-[460px]"><div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full bg-amber-400/10 text-amber-300"><AlertCircle size={17} /></div><h4 className="text-[12px] font-semibold text-slate-200">{error ? "API connection issue" : "Source data unavailable"}</h4><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{error || reason}</p>{retry && error && <button onClick={retry} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-slate-300 hover:bg-white/5"><RefreshCw size={12} />Retry</button>}</div></div>;
}

function EmptyChart({ rows, loading, error, reason, retry }: { rows: unknown[]; loading: boolean; error: string; reason?: string; retry: () => void }) {
  if (loading || error || reason || rows.length === 0) return <DataState loading={loading} error={error} reason={reason || (!rows.length && !loading && !error ? "No records are available for this visualization." : undefined)} retry={retry} />;
  return null;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border border-white/10 bg-[#111a2c] px-3 py-2 shadow-xl"><div className="mb-1 text-[10px] text-slate-400">{label}</div>{payload.map((point, index) => <div key={`${point.name}-${index}`} className="text-[11px]" style={{ color: point.color || "#c4b5fd" }}>{point.name}: {fmt(point.value, 2)}</div>)}</div>;
}

function ChartFrame({ rows, loading, error, reason, retry, children, height = 250 }: { rows: unknown[]; loading: boolean; error: string; reason?: string; retry: () => void; children: ReactNode; height?: number }) {
  return <div style={{ height }}><EmptyChart rows={rows} loading={loading} error={error} reason={reason} retry={retry} />{!loading && !error && !reason && rows.length > 0 && <ResponsiveContainer width="100%" height="100%">{children as ReactElement}</ResponsiveContainer>}</div>;
}

export function Overview({ filters }: { filters: GlobalFilters }) {
  const resource = useResource<OverviewData>(() => getOverview(filters), [filters.start, filters.end, filters.store, filters.family]);
  const data = resource.data;
  const metrics = data?.metrics;
  return <>
    <PageIntro eyebrow="Performance snapshot" title="Executive overview" description="A clear view of historical demand, sales performance, and data-driven business signals." right={<div className="flex items-center gap-2 rounded-lg border border-white/[.08] px-3 py-2 text-[10px] text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${data?.available ? "bg-emerald-400" : "bg-amber-400"}`} />{data?.available ? "Source data connected" : "Awaiting source data"}</div>} />
    {resource.error && <div className="mb-4"><DataState error={resource.error} retry={resource.retry} /></div>}
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Total units sold" value={fmt(metrics?.total_sales)} note="Sum of unit_sales in selected period" icon={ShoppingCartIcon} />
      <MetricCard label="Transactions" value={fmt(metrics?.total_transactions)} note="Separate store/date transaction records" icon={Activity} tone="green" />
      <MetricCard label="Active stores" value={fmt(metrics?.active_stores)} note="Distinct stores with sales" icon={Store} tone="blue" />
      <MetricCard label="Avg. daily demand" value={fmt(metrics?.average_daily_demand)} note="Units per calendar date" icon={TrendingUp} />
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Panel title="Daily demand" subtitle="Historical unit sales and 7-day moving average" className="xl:col-span-2">
        <ChartFrame rows={data?.daily ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry} height={290}>
          <ComposedChart data={data?.daily}><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={VIOLET} stopOpacity={.3} /><stop offset="100%" stopColor={VIOLET} stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} minTickGap={30} /><YAxis tick={axis} tickLine={false} axisLine={false} width={45} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="sales" name="Daily sales" stroke={VIOLET} fill="url(#salesFill)" strokeWidth={2} /><Line type="monotone" dataKey="moving_average" name="7-day average" stroke="#5fe1b2" dot={false} strokeWidth={1.8} /></ComposedChart>
        </ChartFrame>
      </Panel>
      <Panel title="AI business insights" subtitle="Deterministic observations calculated from selected metrics">
        {resource.loading ? <DataState loading /> : !data?.available ? <DataState error={resource.error} reason={data?.reason} retry={resource.retry} /> : <div className="space-y-3">{data.insights.map((insight, i) => <Insight key={i} text={insight} index={i} />)}</div>}
        <div className="mt-4 rounded-lg border border-violet-400/15 bg-violet-400/[.05] p-3 text-[10px] leading-relaxed text-slate-400"><Sparkles size={13} className="mb-1 inline text-violet-300" /> Narrative insights describe observed sales patterns only; they do not prove causal effects.</div>
      </Panel>
      <Panel title="Monthly sales" subtitle="Total units by calendar month">
        <ChartFrame rows={data?.monthly ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry}>
          <BarChart data={data?.monthly}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} minTickGap={24} /><YAxis tick={axis} tickLine={false} axisLine={false} width={45} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="sales" name="Sales" fill={VIOLET} radius={[4, 4, 0, 0]} /></BarChart>
        </ChartFrame>
      </Panel>
      <Panel title="Top product families" subtitle="Ranked by historical units sold">
        <ChartFrame rows={data?.top_families ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry}>
          <BarChart data={data?.top_families} layout="vertical" margin={{ left: 8 }}><CartesianGrid stroke="rgba(148,163,184,.08)" horizontal={false} /><XAxis type="number" tick={axis} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="family" width={104} tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="sales" name="Units sold" fill={VIOLET} radius={[0, 4, 4, 0]} /></BarChart>
        </ChartFrame>
      </Panel>
      <Panel title="Top performing stores" subtitle="Historical units sold by store">
        <ChartFrame rows={data?.top_stores ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry}>
          <BarChart data={data?.top_stores}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="store" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} width={45} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="sales" name="Units sold" fill="#5fe1b2" radius={[4, 4, 0, 0]} /></BarChart>
        </ChartFrame>
      </Panel>
    </div>
    <Panel title="Recent risk alerts" subtitle="Demand-change signals only; inventory stockout/overstock risks require live stock records" className="mt-4">
      {resource.loading ? <DataState loading /> : !data?.available ? <DataState error={resource.error} reason={data?.reason} retry={resource.retry} /> : data.alerts.length ? <div className="space-y-2">{data.alerts.slice(0, 5).map((alert, index) => <div key={`${alert.store}-${alert.family}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300/10 bg-amber-300/[.03] px-3 py-2.5"><div><span className="mr-2 rounded-full bg-amber-300/10 px-2 py-1 text-[9px] uppercase text-amber-200">{alert.severity}</span><span className="text-[10px] font-semibold text-slate-200">{alert.type}</span><p className="mt-1 text-[10px] text-slate-400">{alert.explanation}</p></div><div className="text-right text-[9px] text-slate-500">Store {alert.store} · {alert.family}<br />{alert.timestamp}</div></div>)}</div> : <div className="rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-4 text-[10px] text-slate-400">No demand-change signals meet the configured threshold. This does not imply inventory is risk-free.</div>}
    </Panel>
  </>;
}

const ShoppingCartIcon = ShoppingCart;

export function SalesAnalytics({ filters }: { filters: GlobalFilters }) {
  const resource = useResource<AnalyticsResponse>(() => getAnalytics("sales", filters), [filters.start, filters.end, filters.store, filters.family]);
  const data = resource.data;
  const extras = data;
  return <>
    <PageIntro eyebrow="Revenue & volume" title="Sales analytics" description="Explore daily, weekly, and monthly unit-sales patterns, weekday behavior, and observed relationships in the selected period." />
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><MetricCard label="Total units" value={fmt(Number(data?.summary.total_units))} note="Sum across selected sales rows" icon={ShoppingCartIcon} /><MetricCard label="Avg. daily units" value={fmt(Number(data?.summary.average_daily_units), 1)} note="Includes calendar dates with no sales" icon={TrendingUp} tone="green" /><MetricCard label="Observed dates" value={fmt(Number(data?.summary.date_count))} note="Distinct dates with source records" icon={Activity} tone="blue" /></div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Daily sales & moving average" subtitle="Missing calendar dates are filled with zero for charting"><ChartFrame rows={data?.daily ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry} height={290}><ComposedChart data={data?.daily}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} minTickGap={32} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey="sales" name="Units" fill="#8b5cf6" fillOpacity={.12} stroke={VIOLET} /><Line dataKey="moving_average" name="7-day average" stroke="#5fe1b2" dot={false} /></ComposedChart></ChartFrame></Panel>
      <Panel title="Weekly performance" subtitle="Sales sum by Monday-starting calendar week"><ChartFrame rows={data?.weekly ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry} height={290}><AreaChart data={data?.weekly}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="week" tick={axis} tickLine={false} axisLine={false} minTickGap={26} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey="sales" name="Weekly units" fill={VIOLET} fillOpacity={.12} stroke={VIOLET} /></AreaChart></ChartFrame></Panel>
      <Panel title="Monthly performance" subtitle="Sales sum grouped by calendar month"><ChartFrame rows={data?.monthly ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry} height={290}><BarChart data={data?.monthly}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="sales" name="Units" fill={VIOLET} radius={[4, 4, 0, 0]} /></BarChart></ChartFrame></Panel>
      <Panel title="Average demand by weekday" subtitle="Average total daily units on each weekday"><ChartFrame rows={data?.weekday ?? []} loading={resource.loading} error={resource.error} reason={!data?.available ? data?.reason : undefined} retry={resource.retry}><BarChart data={data?.weekday}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="weekday" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="average_sales" name="Average units" fill="#5fe1b2" radius={[4, 4, 0, 0]} /></BarChart></ChartFrame></Panel>
      <Panel title="Holiday versus non-holiday" subtitle="Observed average daily units on flagged and regular dates"><ChartFrame rows={extras?.holiday ?? []} loading={resource.loading} error={resource.error} reason={extras?.holiday?.length ? undefined : "A holiday indicator is not available in the selected source."} retry={resource.retry}><BarChart data={extras?.holiday ?? []}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="group" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="average_sales" name="Average units" fill={VIOLET} radius={[4, 4, 0, 0]} /></BarChart></ChartFrame></Panel>
      <Panel title="National, regional & local events" subtitle="Average daily sales on flagged versus non-event dates"><ChartFrame rows={data?.event_impact ?? []} loading={resource.loading} error={resource.error} reason={!data?.event_impact?.length ? "The source has no national, regional, or local event flags." : undefined} retry={resource.retry}><BarChart data={data?.event_impact ?? []}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="event" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="event_sales" name="Event date" fill={VIOLET} radius={[4, 4, 0, 0]} /><Bar dataKey="non_event_sales" name="Non-event date" fill="#5fe1b2" radius={[4, 4, 0, 0]} /></BarChart></ChartFrame></Panel>
      <Panel title="Oil price association" subtitle="Date-aligned oil price and total historical daily sales; association is not causation"><ChartFrame rows={data?.oil_scatter ?? []} loading={resource.loading} error={resource.error} reason={!data?.oil_scatter?.length ? "No overlapping oil-price observations are available." : undefined} retry={resource.retry}><ScatterChart><CartesianGrid stroke="rgba(148,163,184,.08)" /><XAxis type="number" dataKey="oil_price" name="Oil price" tick={axis} tickLine={false} axisLine={false} /><YAxis type="number" dataKey="sales" name="Daily sales" tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Scatter data={data?.oil_scatter} fill={VIOLET} /></ScatterChart></ChartFrame></Panel>
      <Panel title="Transactions vs. sales association" subtitle="Daily transactions compared with daily units; omitted for family-only filters"><ChartFrame rows={data?.transaction_scatter ?? []} loading={resource.loading} error={resource.error} reason={!data?.transaction_scatter?.length ? "No date-aligned transaction observations are available for this selection." : undefined} retry={resource.retry}><ScatterChart><CartesianGrid stroke="rgba(148,163,184,.08)" /><XAxis type="number" dataKey="transactions" name="Transactions" tick={axis} tickLine={false} axisLine={false} /><YAxis type="number" dataKey="sales" name="Daily sales" tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Scatter data={data?.transaction_scatter} fill="#5fe1b2" /></ScatterChart></ChartFrame></Panel>
    </div>
    <div className="mt-4 rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3 text-[10px] leading-relaxed text-slate-500">Relationships between sales and events are descriptive associations, not proof of causal impact. Oil-price and transaction associations require date-aligned source datasets and are not inferred where those inputs are absent.</div>
  </>;
}

export function ProductAnalytics({ filters }: { filters: GlobalFilters }) {
  const analytics = useResource<AnalyticsResponse>(() => getAnalytics("products", filters), [filters.start, filters.end, filters.store, filters.family]);
  const table = useResource<ApiDataset>(() => getDataset("products", { pageSize: 100 }), []);
  const [query, setQuery] = useState("");
  const [coldFamily, setColdFamily] = useState("");
  const [referenceStore, setReferenceStore] = useState("");
  const [similarItem, setSimilarItem] = useState("");
  const [scenarioContext, setScenarioContext] = useState("Typical calendar context");
  const [coldStartForecast, setColdStartForecast] = useState<ForecastResponse | null>(null);
  const [coldStartLoading, setColdStartLoading] = useState(false);
  const [coldStartError, setColdStartError] = useState("");
  const families = analytics.data?.families ?? [];
  const matchedProducts = useMemo(() => (table.data?.records ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [table.data, query]);
  const perishable = analytics.data?.summary.perishable_units;
  const perishablePercent = typeof perishable === "number" && Number(analytics.data?.summary.total_units) > 0 ? perishable / Number(analytics.data?.summary.total_units) * 100 : null;
  async function generateFamilyBaseline(event: FormEvent) {
    event.preventDefault();
    if (!coldFamily || !referenceStore.trim()) {
      setColdStartError("Select a product family and enter a reference store.");
      return;
    }
    setColdStartLoading(true);
    setColdStartError("");
    setColdStartForecast(null);
    try {
      setColdStartForecast(await getForecast(referenceStore.trim(), coldFamily, 14, true));
    } catch (reason: unknown) {
      const detail = (reason as { response?: { data?: { detail?: { message?: string } | string } } })?.response?.data?.detail;
      setColdStartError(typeof detail === "string" ? detail : detail?.message ?? "Unable to generate the family reference baseline.");
    } finally {
      setColdStartLoading(false);
    }
  }
  return <>
    <PageIntro eyebrow="Category & item mix" title="Product analytics" description="Historical item and product-family performance. Family-level aggregates are not individual-product model forecasts." />
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><MetricCard label="Product families" value={fmt(Number(analytics.data?.summary.family_count))} note="Distinct families with sales" icon={Package} /><MetricCard label="Historical units" value={fmt(Number(analytics.data?.summary.total_units))} note="Sum of actual sales records" icon={ShoppingCartIcon} tone="green" /><MetricCard label="Perishable share" value={perishablePercent === null ? "—" : `${fmt(perishablePercent, 1)}%`} note={perishablePercent === null ? "Requires item metadata with perishable indicator" : "Sales from products marked perishable"} icon={Boxes} tone="amber" /></div>
    {analytics.error && <DataState error={analytics.error} retry={analytics.retry} />}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Panel title="Family demand ranking" subtitle="Historical units and available product counts" className="xl:col-span-3"><ChartFrame rows={families} loading={analytics.loading} error={analytics.error} reason={!analytics.data?.available ? analytics.data?.reason : undefined} retry={analytics.retry} height={Math.max(260, Math.min(440, families.length * 34))}><BarChart data={families} layout="vertical" margin={{ left: 10 }}><CartesianGrid stroke="rgba(148,163,184,.08)" horizontal={false} /><XAxis type="number" tick={axis} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="family" width={124} tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="demand" name="Units sold" fill={VIOLET} radius={[0, 4, 4, 0]} /></BarChart></ChartFrame></Panel>
      <Panel title="Family demand mix" subtitle="Share of all units sold" className="xl:col-span-2"><ChartFrame rows={families} loading={analytics.loading} error={analytics.error} reason={!analytics.data?.available ? analytics.data?.reason : undefined} retry={analytics.retry}><PieChart><Pie data={families.slice(0, 6)} dataKey="demand" nameKey="family" innerRadius={56} outerRadius={88} paddingAngle={3}>{families.slice(0, 6).map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip content={<ChartTooltip />} /></PieChart></ChartFrame><div className="mt-2 flex flex-wrap gap-2">{families.slice(0, 6).map((row, i) => <span key={String(row.family)} className="flex items-center gap-1 text-[9px] text-slate-400"><i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />{String(row.family)}</span>)}</div></Panel>
    </div>
    <Panel title="Available product metadata" subtitle={`${fmt(table.data?.total)} family-level rows · individual product identifiers are not present in this source`} className="mt-4" action={<div className="relative"><Search size={13} className="absolute left-2.5 top-2 text-slate-500" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search family metadata…" className="h-8 w-48 rounded-lg border border-white/10 bg-white/[.03] pl-8 pr-2 text-[10px] outline-none focus:border-violet-400/40" /></div>}>
      <TableState resource={table} />
      {!table.loading && table.data?.available && <SimpleTable rows={matchedProducts} columns={table.data.columns} />}
    </Panel>
      <Panel title="Perishable inventory attention" subtitle="Exploratory sales variability signals; sales deviations do not prove product waste" className="mt-4">
      {!families.length ? <DataState loading={analytics.loading} reason={!analytics.data?.available ? analytics.data?.reason : "No family demand variability records."} retry={analytics.retry} /> : <div className="space-y-2">{families.filter((row) => row.daily_std !== null).slice(0, 5).map((row) => <div key={String(row.family)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2"><span className="text-[11px] text-slate-200">{String(row.family)}</span><span className="text-[10px] text-slate-400">Historical daily sales standard deviation: {fmt(Number(row.daily_std), 2)}</span><span className="rounded-full bg-amber-400/10 px-2 py-1 text-[9px] text-amber-300">Review demand variability</span></div>)}</div>}
      <div className="mt-3 text-[10px] text-slate-500">Potential excess inventory cannot be established without stock, expiry, and validated item-level forecast records.</div>
    </Panel>
    <Panel title="New product cold-start — experimental" subtitle="Generate a real store–family baseline for planning context; this is not an item-level forecast" className="mt-4">
      <form onSubmit={generateFamilyBaseline}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><label className="text-[10px] text-slate-400">Product family<select value={coldFamily} onChange={(event) => { setColdFamily(event.target.value); setColdStartForecast(null); }} className="mt-1 block h-9 w-full rounded-lg border border-white/10 bg-[#10182a] px-2 text-[11px] text-slate-200"><option value="">Select family</option>{families.map((row) => <option key={String(row.family)} value={String(row.family)}>{String(row.family)}</option>)}</select></label><label className="text-[10px] text-slate-400">Reference store<input value={referenceStore} onChange={(event) => { setReferenceStore(event.target.value); setColdStartForecast(null); }} inputMode="numeric" className="mt-1 block h-9 w-full rounded-lg border border-white/10 bg-[#10182a] px-2 text-[11px] text-slate-200" placeholder="e.g. 44" /></label><label className="text-[10px] text-slate-400">Similar item identifier<input value={similarItem} onChange={(event) => setSimilarItem(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-white/10 bg-[#10182a] px-2 text-[11px] text-slate-200" placeholder="Optional annotation" /></label><label className="text-[10px] text-slate-400">Promotion & season context<select value={scenarioContext} onChange={(event) => setScenarioContext(event.target.value)} className="mt-1 block h-9 w-full rounded-lg border border-white/10 bg-[#10182a] px-2 text-[11px] text-slate-200"><option>Typical calendar context</option><option>Promotion planned</option></select></label></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-[850px] text-[10px] leading-relaxed text-amber-200/70">The LightGBM model supports store–family demand only. Similar-item and promotion entries are scenario annotations and do not alter model features. The 14-day baseline explicitly assumes no unlisted future events.</p><button type="submit" disabled={coldStartLoading || !families.length} className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-500 px-4 text-[10px] font-semibold text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">{coldStartLoading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}{coldStartLoading ? "Generating…" : "Generate family baseline"}</button></div>
      </form>
      {coldStartError && <div role="alert" className="mt-4 rounded-lg border border-rose-300/20 bg-rose-300/[.05] px-3 py-2 text-[10px] text-rose-200">{coldStartError}</div>}
      {coldStartForecast && <div className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[.035] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[11px] font-semibold text-emerald-200">14-day family reference baseline</div><div className="mt-1 text-[9px] text-slate-500">Store {coldStartForecast.selection.store} · {coldStartForecast.selection.family} · {coldStartForecast.forecast_range.start} to {coldStartForecast.forecast_range.end}</div></div><span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-[9px] text-emerald-200">Real LightGBM inference</span></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-white/[.06] bg-[#10182a] p-3"><div className="text-[9px] text-slate-500">Total family demand</div><div className="mt-1 text-[18px] font-bold text-slate-100">{fmt(coldStartForecast.metrics.total_predicted_demand, 1)}</div></div><div className="rounded-lg border border-white/[.06] bg-[#10182a] p-3"><div className="text-[9px] text-slate-500">Average daily demand</div><div className="mt-1 text-[18px] font-bold text-slate-100">{fmt(coldStartForecast.metrics.average_daily_demand, 1)}</div></div><div className="rounded-lg border border-white/[.06] bg-[#10182a] p-3"><div className="text-[9px] text-slate-500">Peak family demand</div><div className="mt-1 text-[18px] font-bold text-slate-100">{fmt(coldStartForecast.metrics.peak_demand, 1)}</div></div></div><p className="mt-3 text-[9px] leading-relaxed text-slate-500">Context: {scenarioContext}{similarItem.trim() ? ` · Similar-item note: ${similarItem.trim()}` : ""}. These annotations are not model inputs. Do not interpret this family baseline as a forecast for a new individual product.</p></div>}
    </Panel>
  </>;
}

export function StoreAnalytics({ filters }: { filters: GlobalFilters }) {
  const resource = useResource<AnalyticsResponse>(() => getAnalytics("stores", filters), [filters.start, filters.end, filters.store, filters.family]);
  const rows = resource.data?.stores ?? [];
  return <>
    <PageIntro eyebrow="Network performance" title="Store analytics" description="Compare store-level sales volume and efficiency where independent transaction records are provided." />
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><MetricCard label="Stores represented" value={fmt(Number(resource.data?.summary.store_count))} note="Distinct stores in selected sales period" icon={Store} /><MetricCard label="Total units sold" value={fmt(Number(resource.data?.summary.total_units))} note="Historical units across matched stores" icon={ShoppingCartIcon} tone="green" /></div>
    {resource.error && <DataState error={resource.error} retry={resource.retry} />}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><Panel title="Store performance ranking" subtitle="Historical unit sales by store"><ChartFrame rows={rows.slice(0, 14)} loading={resource.loading} error={resource.error} reason={!resource.data?.available ? resource.data?.reason : undefined} retry={resource.retry} height={320}><BarChart data={rows.slice(0, 14)} layout="vertical" margin={{ left: 10 }}><CartesianGrid stroke="rgba(148,163,184,.08)" horizontal={false} /><XAxis type="number" tick={axis} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="store" tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="units" name="Units sold" fill="#5fe1b2" radius={[0, 4, 4, 0]} /></BarChart></ChartFrame></Panel>
      <Panel title="Store efficiency" subtitle="Units sold per transaction from deduplicated store/date counts"><ChartFrame rows={rows.filter((row) => row.efficiency !== null).slice(0, 14)} loading={resource.loading} error={resource.error} reason={!rows.some((row) => row.efficiency !== null) ? "Independent store/date transaction counts are unavailable for this source." : undefined} retry={resource.retry}><BarChart data={rows.filter((row) => row.efficiency !== null).slice(0, 14)}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="store" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="efficiency" name="Units / transaction" fill={VIOLET} radius={[4, 4, 0, 0]} /></BarChart></ChartFrame></Panel></div>
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3"><Panel title={filters.store ? `Store ${filters.store} demand trend` : "Network demand trend"} subtitle={filters.store ? "Daily units for the selected store" : "Daily total units across the selected store network"}><ChartFrame rows={resource.data?.daily_trend ?? []} loading={resource.loading} error={resource.error} reason={!resource.data?.available ? resource.data?.reason : undefined} retry={resource.retry}><AreaChart data={resource.data?.daily_trend}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} minTickGap={30} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Area dataKey="units" name="Daily units" stroke={VIOLET} fill={VIOLET} fillOpacity={.12} /></AreaChart></ChartFrame></Panel><Panel title="Store type comparison" subtitle="Total units across stores in each store type"><ChartFrame rows={resource.data?.store_types ?? []} loading={resource.loading} error={resource.error} reason={!resource.data?.store_types?.length ? "Store type metadata is unavailable." : undefined} retry={resource.retry}><BarChart data={resource.data?.store_types}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="store_type" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="units" name="Units sold" fill="#5fe1b2" radius={[4, 4, 0, 0]} /></BarChart></ChartFrame></Panel><Panel title="City performance" subtitle="Historical units across stores in each city"><ChartFrame rows={resource.data?.cities ?? []} loading={resource.loading} error={resource.error} reason={!resource.data?.cities?.length ? "City metadata is unavailable." : undefined} retry={resource.retry}><BarChart data={resource.data?.cities?.slice(0, 10)} layout="vertical"><CartesianGrid stroke="rgba(148,163,184,.08)" horizontal={false} /><XAxis type="number" tick={axis} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="city" width={90} tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="units" name="Units sold" fill="#f5b544" radius={[0, 4, 4, 0]} /></BarChart></ChartFrame></Panel></div>
    <Panel title="Store comparison" subtitle="Sales, transactions, efficiency, city, store type, and active dates" className="mt-4">{!rows.length ? <DataState loading={resource.loading} error={resource.error} reason={!resource.data?.available ? resource.data?.reason : "No store records."} retry={resource.retry} /> : <div className="scrollbar-thin overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[10px]"><thead><tr className="border-b border-white/[.07] text-slate-500">{["Store", "City", "Type", "Cluster", "Units sold", "Transactions", "Units / transaction", "Active dates"].map((item) => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.store)} className="border-b border-white/[.04] text-slate-300"><td className="px-3 py-2.5 font-medium">{String(row.store)}</td><td className="px-3 py-2.5">{String(row.city ?? "—")}</td><td className="px-3 py-2.5">{String(row.store_type ?? "—")}</td><td className="px-3 py-2.5">{String(row.cluster ?? "—")}</td><td className="px-3 py-2.5">{fmt(Number(row.units))}</td><td className="px-3 py-2.5">{fmt(typeof row.transactions === "number" ? row.transactions : null)}</td><td className="px-3 py-2.5">{fmt(typeof row.efficiency === "number" ? row.efficiency : null, 2)}</td><td className="px-3 py-2.5">{fmt(Number(row.active_days))}</td></tr>)}</tbody></table></div>}</Panel>
  </>;
}

export function Forecasting() {
  const products = useResource<ApiDataset>(() => getDataset("products", { pageSize: 500 }), []);
  const stores = useResource<ApiDataset>(() => getDataset("stores", { pageSize: 500 }), []);
  const [store, setStore] = useState("");
  const [family, setFamily] = useState("");
  const [horizon, setHorizon] = useState(28);
  const [assumeNoEvents, setAssumeNoEvents] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [forecastResult, setForecastResult] = useState<ForecastResponse | null>(null);
  const storeOptions = [...new Set((stores.data?.records ?? []).map((r) => String(r.store_nbr ?? "")).filter(Boolean))];
  const familyOptions = [...new Set((products.data?.records ?? []).map((r) => String(r.family ?? "")).filter(Boolean))];
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(""); setForecastResult(null);
    try { setForecastResult(await getForecast(store, family, horizon, assumeNoEvents)); }
    catch (error) {
      const detail = (error as { response?: { data?: { detail?: { message?: string } | string } } }).response?.data?.detail;
      setMessage(typeof detail === "object" ? detail?.message ?? "The forecast pipeline is unavailable." : typeof detail === "string" ? detail : "Unable to connect to the forecast API.");
    } finally { setBusy(false); }
  }
  return <>
    <PageIntro eyebrow="Validated LightGBM inference" title="Demand forecasting" description="Generate daily store–product-family forecasts with the supplied 56-feature model and explicit future-calendar assumptions." />
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Panel title="Forecast configuration" subtitle="Select a model-supported store/family pair and horizon" className="xl:col-span-1">
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-[10px] font-medium text-slate-400">Store<select required value={store} onChange={(e) => setStore(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#10182a] px-3 text-[11px] text-slate-200"><option value="">Select a store</option>{storeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label className="block text-[10px] font-medium text-slate-400">Product family<select required value={family} onChange={(e) => setFamily(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-[#10182a] px-3 text-[11px] text-slate-200"><option value="">Select a family</option>{familyOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label className="block text-[10px] font-medium text-slate-400">Forecast horizon <span className="float-right text-violet-200">{horizon} days</span><input type="range" min="1" max="76" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="mt-3 block w-full accent-violet-500" /><div className="mt-2 flex gap-1.5">{[7, 14, 28, 76].map((days) => <button type="button" key={days} onClick={() => setHorizon(days)} className={`rounded-md border px-2 py-1 text-[9px] ${horizon === days ? "border-violet-400/40 bg-violet-400/10 text-violet-200" : "border-white/10 text-slate-500"}`}>{days}d</button>)}</div></label>
          <label className="flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[.04] p-3 text-[10px] leading-relaxed text-slate-400"><input type="checkbox" checked={assumeNoEvents} onChange={(e) => setAssumeNoEvents(e.target.checked)} className="mt-0.5 accent-violet-500" /><span>Assume no unlisted holidays or events after the historical data ends. This explicit scenario is required until a future calendar is supplied.</span></label>
          <Button type="submit" disabled={busy || !store || !family} className="w-full">{busy ? <RefreshCw size={14} className="animate-spin" /> : <TrendingUp size={14} />}Generate forecast</Button>
        </form>
        <div className="mt-4 rounded-lg border border-emerald-400/15 bg-emerald-400/[.04] p-3"><div className="mb-1 text-[10px] font-semibold text-emerald-200">Model validated</div><p className="text-[10px] leading-relaxed text-slate-400">LightGBM 4.7 · 56 ordered features · 379 trees · maximum validated horizon 76 days.</p></div>
      </Panel>
      <Panel title="Forecast outlook" subtitle="Actual predictions and evaluation metrics appear here only after inference artifacts validate" className="xl:col-span-2">
        {message && <div className="mb-4 rounded-lg border border-amber-300/15 bg-amber-300/[.05] p-3 text-[11px] text-amber-100">{message}</div>}
        {forecastResult ? <><ChartFrame rows={[...forecastResult.historical, ...forecastResult.forecast]} loading={false} error="" retry={() => {}} height={290}><ComposedChart data={[...forecastResult.historical.map((row) => ({ ...row, prediction: null })), ...forecastResult.forecast.map((row) => ({ ...row, actual: null }))]}><CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} /><XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} minTickGap={28} /><YAxis tick={axis} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltip />} /><Line dataKey="actual" name="Historical actual" stroke="#5fe1b2" dot={false} /><Line dataKey="prediction" name="LightGBM forecast" stroke={VIOLET} dot={false} strokeDasharray="5 3" /></ComposedChart></ChartFrame><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-slate-500"><span>Origin {forecastResult.selection.origin} · Forecast {forecastResult.forecast_range.start} to {forecastResult.forecast_range.end}</span><button onClick={() => { const csv = ["date,prediction", ...forecastResult.forecast.map((row) => `${row.date},${row.prediction}`)].join("\r\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `nexus-forecast-${store}-${family}-${horizon}d.csv`; link.click(); URL.revokeObjectURL(link.href); }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300"><Download size={11} />Export CSV</button></div><div className="mt-3 rounded-lg bg-white/[.025] p-3">{forecastResult.assumptions.map((item) => <p key={item} className="mb-1 text-[9px] text-slate-500">• {item}</p>)}</div><Button size="sm" className="mt-3" onClick={() => { sessionStorage.setItem("nexusForecastForInventory", JSON.stringify({ store, family, average_daily_demand: forecastResult.metrics.average_daily_demand, dates: forecastResult.forecast_range, forecast: forecastResult.forecast })); window.location.href = "/inventory"; }}><Boxes size={13} />Use in Inventory Planning</Button></> : <div className="grid min-h-[270px] place-items-center rounded-lg border border-dashed border-white/10 bg-white/[.01] px-6 text-center"><div><div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><Activity size={20} /></div><p className="text-[12px] font-medium text-slate-300">Ready for a forecast scenario</p><p className="mx-auto mt-1 max-w-[380px] text-[10px] leading-relaxed text-slate-500">Select a supported series, choose a day-based horizon, and explicitly provide or acknowledge future calendar assumptions.</p></div></div>}
      </Panel>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Total predicted demand" value={fmt(forecastResult?.metrics.total_predicted_demand)} note={forecastResult ? `${forecastResult.selection.horizon_days}-day total` : "Generate a forecast"} icon={Activity} /><MetricCard label="Avg. daily demand" value={fmt(forecastResult?.metrics.average_daily_demand, 1)} note="Store-family daily units" icon={TrendingUp} tone="green" /><MetricCard label="Peak demand" value={fmt(forecastResult?.metrics.peak_demand)} note={forecastResult?.metrics.peak_date ?? "Generate a forecast"} icon={Activity} tone="amber" /><MetricCard label="Test MAE" value={fmt(forecastResult ? Number(forecastResult.evaluation.test_mae) : null, 1)} note="Supplied held-out evaluation metadata" icon={Activity} tone="blue" /></div>
  </>;
}

export function InventoryPlanning({ filters }: { filters: GlobalFilters }) {
  const forecastInput = useMemo(() => { try { return JSON.parse(sessionStorage.getItem("nexusForecastForInventory") ?? "null") as { store: string; family: string; average_daily_demand: number; dates: { start: string; end: string } } | null; } catch { return null; } }, []);
  const [values, setValues] = useState({ average_daily_demand: forecastInput ? String(forecastInput.average_daily_demand) : "", daily_demand_std: "", on_hand: "", incoming: "0", backorders: "0", lead_time_days: "7", review_period_days: "7", service_level: "0.95", shelf_life_days: "" });
  const [result, setResult] = useState<Awaited<ReturnType<typeof calculateInventory>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demandStats, setDemandStats] = useState<Awaited<ReturnType<typeof getInventoryDemandStats>> | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const sourceStore = forecastInput?.store ?? filters.store;
  const sourceFamily = forecastInput?.family ?? filters.family;
  useEffect(() => {
    if (!sourceStore || !sourceFamily) {
      setDemandStats(null);
      setStatsError("");
      return;
    }
    let active = true;
    setStatsLoading(true);
    setStatsError("");
    getInventoryDemandStats(sourceStore, sourceFamily, 90)
      .then((stats) => {
        if (!active) return;
        setDemandStats(stats);
        setValues((current) => ({
          ...current,
          average_daily_demand: forecastInput ? current.average_daily_demand : String(stats.average_daily_demand),
          daily_demand_std: String(stats.daily_demand_std),
        }));
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setDemandStats(null);
        setStatsError((reason as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Historical demand variability could not be calculated.");
      })
      .finally(() => { if (active) setStatsLoading(false); });
    return () => { active = false; };
  }, [sourceStore, sourceFamily, forecastInput]);
  const change = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function calculate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try {
      setResult(await calculateInventory({
        average_daily_demand: Number(values.average_daily_demand), daily_demand_std: Number(values.daily_demand_std),
        on_hand: Number(values.on_hand), incoming: Number(values.incoming), backorders: Number(values.backorders),
        lead_time_days: Number(values.lead_time_days), review_period_days: Number(values.review_period_days),
        service_level: Number(values.service_level), shelf_life_days: values.shelf_life_days ? Number(values.shelf_life_days) : undefined,
      }));
    } catch (reason) { setError((reason as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Inventory calculation failed. Check the values and retry."); }
    finally { setBusy(false); }
  }
  const fields: Array<{ key: keyof typeof values; label: string; min?: string; step?: string; help?: string }> = [
    { key: "average_daily_demand", label: "Average daily demand", min: "0", step: "any" },
    { key: "daily_demand_std", label: "Daily demand standard deviation", min: "0", step: "any", help: demandStats ? `Automatically calculated from ${demandStats.lookback_days} calendar days (${demandStats.period.start} to ${demandStats.period.end}). You may override it.` : "Select a Store and Family in the top filters to calculate this automatically." },
    { key: "on_hand", label: "Current on-hand stock", min: "0", step: "any" },
    { key: "incoming", label: "Incoming stock", min: "0", step: "any" },
    { key: "backorders", label: "Backorders", min: "0", step: "any" },
    { key: "lead_time_days", label: "Supplier lead time (days)", min: "0" },
    { key: "review_period_days", label: "Review period (days)", min: "0" },
    { key: "shelf_life_days", label: "Shelf life (optional, days)", min: "1" },
  ];
  return <>
    <PageIntro eyebrow="Replenishment planning" title="Inventory planning" description="Calculate transparent reorder and order-quantity estimates from demand variability and stock inputs you provide." />
    {forecastInput && <div className="mb-4 rounded-lg border border-emerald-400/15 bg-emerald-400/[.04] p-3 text-[10px] text-emerald-100/80">Using LightGBM average demand for Store {forecastInput.store} · {forecastInput.family} · {forecastInput.dates.start} to {forecastInput.dates.end}. Historical demand variability is calculated automatically below.</div>}
    {!sourceStore || !sourceFamily ? <div className="mb-4 rounded-lg border border-amber-400/15 bg-amber-400/[.04] p-3 text-[10px] text-amber-100/80">Select one Store and one Family in the top filters to automatically calculate average demand and standard deviation.</div> : statsLoading ? <div className="mb-4 flex items-center gap-2 rounded-lg border border-violet-400/15 bg-violet-400/[.04] p-3 text-[10px] text-violet-100/80"><RefreshCw size={13} className="animate-spin" />Calculating 90-day demand variability for Store {sourceStore} · {sourceFamily}…</div> : demandStats ? <div className="mb-4 rounded-lg border border-emerald-400/15 bg-emerald-400/[.04] p-3 text-[10px] text-emerald-100/80"><span className="font-semibold">Demand variability calculated:</span> {fmt(demandStats.daily_demand_std, 3)} units/day standard deviation from {demandStats.lookback_days} calendar days. {demandStats.method}</div> : statsError ? <div role="alert" className="mb-4 rounded-lg border border-rose-400/15 bg-rose-400/[.04] p-3 text-[10px] text-rose-100/80">{statsError}</div> : null}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Panel title="Planning inputs" subtitle="Enter real inventory and supplier data" className="xl:col-span-3">
        <form onSubmit={calculate}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{fields.map((field) => <label key={field.key} className="text-[10px] text-slate-400">{field.label}<input required={field.key !== "shelf_life_days"} type="number" min={field.min} step={field.step ?? "1"} value={values[field.key]} onChange={(e) => change(field.key, e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-white/10 bg-[#10182a] px-2.5 text-[11px] text-slate-200 outline-none focus:border-violet-400/40" />{field.help && <span className="mt-1 block text-[9px] text-slate-600">{field.help}</span>}</label>)}
            <label className="text-[10px] text-slate-400">Desired service level<select value={values.service_level} onChange={(e) => change("service_level", e.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-white/10 bg-[#10182a] px-2.5 text-[11px] text-slate-200"><option value="0.9">90%</option><option value="0.95">95%</option><option value="0.975">97.5%</option><option value="0.99">99%</option></select></label>
          </div>
          <Button type="submit" disabled={busy} size="sm" className="mt-4">{busy && <RefreshCw size={13} className="animate-spin" />}Calculate replenishment</Button>
        </form>
        {error && <p className="mt-3 text-[10px] text-rose-300">{error}</p>}
      </Panel>
      <Panel title="Calculated recommendation" subtitle="Planning estimate based on entered values" className="xl:col-span-2">
        {!result ? <div className="grid min-h-[230px] place-items-center text-center"><div><Boxes size={25} className="mx-auto mb-3 text-slate-600" /><p className="text-[11px] text-slate-400">Enter your demand and inventory inputs to calculate a replenishment estimate.</p></div></div> : <div className="space-y-2"><ResultRow label="Suggested order quantity" value={fmt(result.suggested_order_quantity)} strong /><ResultRow label="Safety stock" value={fmt(result.safety_stock)} /><ResultRow label="Reorder point" value={fmt(result.reorder_point)} /><ResultRow label="Inventory position" value={fmt(result.inventory_position, 1)} /><ResultRow label="Target stock" value={fmt(result.target_stock)} /><ResultRow label="Inventory coverage" value={result.inventory_coverage_days === null ? "—" : `${fmt(result.inventory_coverage_days, 1)} days`} /><div className="mt-3 rounded-lg bg-white/[.025] p-3">{result.assumptions.map((item, index) => <p key={index} className="mb-1 text-[9px] leading-relaxed text-slate-500">• {item}</p>)}</div></div>}
      </Panel>
    </div>
    <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[.04] p-3 text-[10px] leading-relaxed text-amber-100/70">No current-stock records or supplier data were present in the workspace. Estimates are produced only from values entered above; do not treat them as live inventory recommendations.</div>
  </>;
}

function ResultRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${strong ? "border border-violet-400/20 bg-violet-400/[.07]" : "bg-white/[.02]"}`}><span className="text-[10px] text-slate-400">{label}</span><span className={`text-[12px] font-semibold ${strong ? "text-violet-200" : "text-slate-200"}`}>{value}</span></div>;
}

export function RiskMonitoring({ filters }: { filters: GlobalFilters }) {
  const [severity, setSeverity] = useState("");
  const [type, setType] = useState("");
  const resource = useResource(() => getAlerts({ ...filters, severity: severity || undefined, type: type || undefined }), [filters.start, filters.end, filters.store, filters.family, severity, type]);
  const alerts = resource.data?.alerts ?? [];
  return <>
    <PageIntro eyebrow="Operational monitoring" title="Risk monitoring" description="Observe demand-change alerts from historical data. Stockout and overstock claims require current inventory and validated forecasts." right={<div className="flex gap-2"><select value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-8 rounded-lg border border-white/10 bg-[#10182a] px-2 text-[10px] text-slate-300"><option value="">All severities</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select><select value={type} onChange={(e) => setType(e.target.value)} className="h-8 rounded-lg border border-white/10 bg-[#10182a] px-2 text-[10px] text-slate-300"><option value="">All alert types</option><option value="Demand increase">Demand increase</option><option value="stockout">Potential stockout</option><option value="overstock">Potential overstock</option></select></div>} />
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><MetricCard label="Demand change alerts" value={fmt(alerts.length)} note="Computed from historical sales only" icon={AlertCircle} tone="amber" /><MetricCard label="Stockout signals" value="—" note="Requires current stock and forecast data" icon={Boxes} /><MetricCard label="Perishable risk" value="—" note="Requires item-level inventory and expiry data" icon={Package} tone="blue" /></div>
    {resource.error && <DataState error={resource.error} retry={resource.retry} />}
    <Panel title="Risk signals" subtitle="Each signal includes a transparent threshold and actionable review step">
      {resource.loading ? <DataState loading /> : resource.data?.available && alerts.length ? <div className="space-y-3">{alerts.map((alert, index) => <div key={index} className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="rounded-full bg-amber-300/10 px-2 py-1 text-[9px] font-semibold uppercase text-amber-200">{String(alert.severity)}</span><span className="text-[11px] font-semibold text-slate-200">{String(alert.type)}</span></div><span className="text-[9px] text-slate-500">{String(alert.timestamp)}</span></div><div className="mt-2 text-[10px] text-slate-400">Store {String(alert.store)} · {String(alert.family)}</div><p className="mt-2 text-[10px] leading-relaxed text-slate-300">{String(alert.explanation)}</p><p className="mt-2 text-[10px] leading-relaxed text-emerald-200/80">Suggested action: {String(alert.suggested_action)}</p></div>)}</div> : <DataState reason={resource.data?.reason ?? "No alerts meet the configured demand-change threshold. This does not imply inventory is risk-free."} />}
    </Panel>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">{[["Demand increase", "At least 50% above the preceding 21-day average"], ["Potential stockout", "Not generated without inventory quantities and a supported forecast"], ["Potential overstock", "Not generated without current stock, expiry, and forecast data"]].map(([label, detail]) => <div key={label} className="rounded-lg border border-white/[.07] bg-white/[.02] p-3"><div className="text-[10px] font-semibold text-slate-300">{label}</div><div className="mt-1 text-[9px] leading-relaxed text-slate-500">{detail}</div></div>)}</div>
  </>;
}

export function AddData() {
  const [file, setFile] = useState<File | null>(null);
  const [dataset, setDataset] = useState("Sales history");
  const [mode, setMode] = useState("Append new records");
  const [complete, setComplete] = useState(false);

  const chooseFile = (selected: File | null) => {
    setFile(selected);
    setComplete(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (file) setComplete(true);
  };
  const fileSize = file ? file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB` : "";

  return <>
    <PageIntro eyebrow="Data workspace" title="Add data" description="Preview a future data-ingestion workflow. This demonstration is frontend-only: files are never uploaded, parsed, stored, or sent to the API." right={<span className="rounded-full border border-amber-300/20 bg-amber-300/[.07] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-amber-200">UI demonstration</span>} />
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Panel title="Import configuration" subtitle="Choose how the source would be categorized" className="xl:col-span-1">
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-[10px] font-medium text-slate-400">Dataset type<select value={dataset} onChange={(event) => { setDataset(event.target.value); setComplete(false); }} className="mt-1.5 block h-10 w-full rounded-lg border border-white/10 bg-[#10182a] px-3 text-[11px] text-slate-200 outline-none focus:border-violet-400/50"><option>Sales history</option><option>Store metadata</option><option>Product catalog</option><option>Transactions</option><option>Holiday calendar</option><option>Oil prices</option><option>Inventory snapshot</option></select></label>
          <label className="block text-[10px] font-medium text-slate-400">Import behavior<select value={mode} onChange={(event) => { setMode(event.target.value); setComplete(false); }} className="mt-1.5 block h-10 w-full rounded-lg border border-white/10 bg-[#10182a] px-3 text-[11px] text-slate-200 outline-none focus:border-violet-400/50"><option>Append new records</option><option>Replace matching dataset</option><option>Validate only</option></select></label>
          <div className="rounded-lg border border-white/[.07] bg-white/[.025] p-3 text-[10px] leading-relaxed text-slate-500"><span className="font-semibold text-slate-300">Expected formats</span><br />CSV, Parquet, JSON, or Excel · maximum 250 MB</div>
          <button type="submit" disabled={!file} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 text-[11px] font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"><UploadCloud size={15} />Simulate adding data</button>
        </form>
      </Panel>

      <Panel title="Select source file" subtitle="The selected file remains in your browser and is not read" className="xl:col-span-2">
        {!file ? <label className="group grid min-h-[250px] cursor-pointer place-items-center rounded-xl border border-dashed border-violet-400/25 bg-violet-400/[.025] px-6 text-center transition hover:border-violet-400/50 hover:bg-violet-400/[.045]">
          <input type="file" accept=".csv,.parquet,.json,.xlsx,.xls" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
          <div><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-violet-400/10 text-violet-300 ring-1 ring-violet-400/20"><UploadCloud size={22} /></div><h3 className="mt-4 text-[13px] font-semibold text-slate-200">Choose a data file</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-500">Click to browse CSV, Parquet, JSON, or Excel files.<br />Nothing will leave this device.</p></div>
        </label> : <div className="space-y-4">
          <div className="flex min-h-[112px] flex-wrap items-center gap-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[.035] p-4"><div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-300/10 text-emerald-300"><FileSpreadsheet size={21} /></div><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold text-slate-200">{file.name}</div><div className="mt-1 text-[10px] text-slate-500">{fileSize} · selected locally</div></div><button type="button" onClick={() => chooseFile(null)} aria-label="Remove selected file" className="rounded-lg p-2 text-slate-500 hover:bg-white/[.05] hover:text-rose-300"><X size={16} /></button></div>
          <div className="grid gap-3 sm:grid-cols-3">{[["Dataset", dataset], ["Action", mode], ["Connection", "Frontend preview only"]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[.07] bg-white/[.02] p-3"><div className="text-[9px] uppercase tracking-[.12em] text-slate-600">{label}</div><div className="mt-1.5 text-[10px] font-medium text-slate-300">{value}</div></div>)}</div>
          {complete && <div role="status" className="flex gap-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] p-4"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" /><div><div className="text-[11px] font-semibold text-emerald-200">Demo import completed</div><p className="mt-1 text-[10px] leading-relaxed text-slate-400">This is a visual confirmation only. No file content was processed and no application data changed.</p></div></div>}
        </div>}
      </Panel>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">{[["1", "Select a source", "Choose a local file to represent the future upload flow."], ["2", "Review settings", "Confirm the dataset category and simulated import behavior."], ["3", "Simulate import", "Display a frontend-only success state without changing data."]].map(([step, title, text]) => <div key={step} className="surface rounded-xl p-4"><div className="grid h-7 w-7 place-items-center rounded-lg bg-violet-400/10 text-[10px] font-bold text-violet-200">{step}</div><div className="mt-3 text-[11px] font-semibold text-slate-200">{title}</div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{text}</p></div>)}</div>
  </>;
}

const datasetOptions = ["sales", "stores", "products", "transactions", "holidays", "oil", "forecasts", "inventory"];

export function DataExplorer() {
  const [dataset, setDataset] = useState("sales");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const resource = useResource<ApiDataset>(() => getDataset(dataset, { page, pageSize: 25, search, sort: sort || undefined, order }), [dataset, page, search, sort, order]);
  useEffect(() => setPage(1), [dataset, search]);
  useEffect(() => setHiddenColumns([]), [dataset]);
  const data = resource.data;
  const visibleColumns = data?.columns.filter((column) => !hiddenColumns.includes(column)) ?? [];
  function exportCsv() {
    if (!data?.records.length) return;
    const columns = visibleColumns;
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [columns.map(escape).join(","), ...data.records.map((row) => columns.map((col) => escape(row[col])).join(","))].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `nexus-${dataset}-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return <>
    <PageIntro eyebrow="Source records" title="Data explorer" description="Search, sort, paginate, inspect missing values, and export the currently visible source-data page." right={<button onClick={exportCsv} disabled={!data?.records.length} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-[10px] text-slate-300 hover:bg-white/[.04] disabled:opacity-40"><Download size={13} />Export page CSV</button>} />
    <Panel title="Dataset browser" subtitle="Server-paginated responses; raw multi-million-row files are not sent to the browser">
      <div className="mb-4 flex flex-wrap items-center gap-2"><label className="text-[10px] text-slate-500">Dataset<select value={dataset} onChange={(e) => setDataset(e.target.value)} className="ml-2 h-8 rounded-lg border border-white/10 bg-[#10182a] px-2 text-[10px] text-slate-200">{datasetOptions.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></label><details className="relative text-[10px] text-slate-400"><summary className="cursor-pointer rounded-lg border border-white/10 px-2.5 py-2">Columns ({visibleColumns.length})</summary><div className="absolute left-0 top-9 z-10 max-h-64 w-56 overflow-auto rounded-lg border border-white/10 bg-[#111a2c] p-2 shadow-xl">{data?.columns.map((column) => <label key={column} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/[.04]"><input type="checkbox" checked={!hiddenColumns.includes(column)} onChange={() => setHiddenColumns((current) => current.includes(column) ? current.filter((value) => value !== column) : [...current, column])} className="accent-violet-500" />{column}</label>)}</div></details><div className="relative ml-auto"><Search size={13} className="absolute left-2.5 top-2 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all source fields…" className="h-8 w-[220px] rounded-lg border border-white/10 bg-white/[.03] pl-8 pr-2 text-[10px] text-slate-200 outline-none focus:border-violet-400/40" /></div></div>
      <TableState resource={resource} />
      {data?.available && <><div className="mb-2 flex flex-wrap justify-between gap-2 text-[9px] text-slate-500"><span>{fmt(data.total)} matching records · Page {data.page}</span><span>{Object.values(data.missing).reduce((sum, value) => sum + value, 0)} missing values across dataset</span></div><ExplorerTable data={data} columns={visibleColumns} sort={sort} order={order} onSort={(column) => { setSort(column); setOrder(sort === column && order === "asc" ? "desc" : "asc"); }} /><div className="mt-3 flex items-center justify-between"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-slate-300 disabled:opacity-40">Previous</button><span className="text-[10px] text-slate-500">Showing {data.records.length} of {fmt(data.total)}</span><button disabled={page * data.page_size >= data.total} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-slate-300 disabled:opacity-40">Next</button></div><div className="mt-3 flex flex-wrap gap-2">{Object.entries(data.missing).filter(([, count]) => count > 0).slice(0, 8).map(([column, count]) => <span key={column} className="rounded-full border border-amber-300/10 bg-amber-300/[.04] px-2 py-1 text-[9px] text-amber-200/70">{column}: {fmt(count)} missing</span>)}</div></>}
    </Panel>
  </>;
}

function TableState({ resource }: { resource: { loading: boolean; error: string; data: ApiDataset | null; retry: () => void } }) {
  if (resource.loading || resource.error || !resource.data?.available) return <DataState loading={resource.loading} error={resource.error} reason={resource.data?.reason} retry={resource.retry} />;
  return null;
}

function SimpleTable({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  if (!rows.length) return <DataState reason="No matching product metadata rows." />;
  return <div className="scrollbar-thin max-h-[360px] overflow-auto"><table className="w-full min-w-[520px] text-left text-[10px]"><thead className="sticky top-0 bg-[#151d30]"><tr>{columns.map((col) => <th key={col} className="border-b border-white/[.07] px-3 py-2 text-slate-500">{col}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-b border-white/[.04] text-slate-300">{columns.map((col) => <td key={col} className="max-w-[240px] truncate px-3 py-2">{String(row[col] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

function ExplorerTable({ data, columns, sort, order, onSort }: { data: ApiDataset; columns: string[]; sort: string; order: string; onSort: (column: string) => void }) {
  if (!data.records.length) return <DataState reason="No records match the current search." />;
  if (!columns.length) return <DataState reason="Select at least one visible column." />;
  return <div className="scrollbar-thin max-h-[520px] overflow-auto rounded-lg border border-white/[.06]"><table className="w-full min-w-[700px] text-left text-[10px]"><thead className="sticky top-0 bg-[#111a2c]"><tr>{columns.map((column) => <th key={column} className="border-b border-white/[.08] px-3 py-2"><button onClick={() => onSort(column)} className="font-semibold text-slate-400 hover:text-violet-200">{column}{sort === column ? order === "asc" ? " ↑" : " ↓" : ""}</button></th>)}</tr></thead><tbody>{data.records.map((record, index) => <tr key={index} className="border-b border-white/[.035] text-slate-300 hover:bg-white/[.02]">{columns.map((column) => <td key={column} className="max-w-[250px] truncate px-3 py-2">{String(record[column] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

function Insight({ text, index }: { text: string; index: number }) {
  return <div className="flex gap-3 rounded-lg border border-white/[.06] bg-white/[.02] p-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-violet-400/10 text-[10px] font-bold text-violet-200">0{index + 1}</span><p className="pt-0.5 text-[11px] leading-relaxed text-slate-300">{text}</p></div>;
}
