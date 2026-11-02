import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity, AlertTriangle, BarChart3, Boxes, ChevronDown, ChevronLeft,
  ChevronRight, Command, Database, LayoutDashboard, Menu, PackageSearch,
  Settings2, Store, UploadCloud, X,
} from "lucide-react";
import { Overview, SalesAnalytics, ProductAnalytics, StoreAnalytics, Forecasting, InventoryPlanning, RiskMonitoring, DataExplorer, AddData } from "./pages/DashboardPages";
import { getDataset, getHealth } from "./services/api";
import type { GlobalFilters } from "./types";

const navigation = [
  { label: "Executive Overview", path: "/", icon: LayoutDashboard },
  { label: "Sales Analytics", path: "/sales", icon: BarChart3 },
  { label: "Product Analytics", path: "/products", icon: PackageSearch },
  { label: "Store Analytics", path: "/stores", icon: Store },
  { label: "Demand Forecasting", path: "/forecasting", icon: Activity },
  { label: "Inventory Planning", path: "/inventory", icon: Boxes },
  { label: "Risk Monitoring", path: "/risks", icon: AlertTriangle },
  { label: "Data Explorer", path: "/data", icon: Database },
  { label: "Add Data", path: "/add-data", icon: UploadCloud },
];

const titles: Record<string, string> = Object.fromEntries(navigation.map((item) => [item.path, item.label]));

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filters, setFilters] = useState<GlobalFilters>({});
  const [health, setHealth] = useState<{ status?: string; data_available?: boolean; model_available?: boolean; date_range?: { start: string; end: string } | null }>({});
  const [healthError, setHealthError] = useState("");
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    let active = true;
    getHealth().then((result) => {
      if (active) { setHealth(result); setHealthError(""); }
    }).catch(() => { if (active) setHealthError("API offline"); });
    return () => { active = false; };
  }, []);

  return (
    <div className="min-h-screen bg-[#0b1020] text-slate-100">
      {mobileOpen && <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-black/60 lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/[.07] bg-[#0d1426] transition-all duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} ${collapsed ? "w-[76px]" : "w-[252px]"}`}>
        <div className={`flex h-[76px] items-center border-b border-white/[.07] ${collapsed ? "justify-center" : "gap-3 px-6"}`}>
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/25"><Command size={19} /></div>
          {!collapsed && <div><div className="font-[Manrope] text-[16px] font-extrabold tracking-[.12em]">NEXUS</div><div className="text-[9px] font-semibold tracking-[.2em] text-slate-500">DEMAND INTELLIGENCE</div></div>}
          <button onClick={() => setMobileOpen(false)} className="ml-auto p-2 text-slate-500 lg:hidden" aria-label="Close sidebar"><X size={17} /></button>
        </div>
        <div className={`px-3 pt-6 ${collapsed ? "px-2" : ""}`}>
          {!collapsed && <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.17em] text-slate-600">Workspace</p>}
          <nav className="space-y-1">
            {navigation.map(({ label, path, icon: Icon }) => (
              <NavLink key={path} to={path} title={collapsed ? label : undefined} className={({ isActive }) => `group flex h-10 items-center gap-3 rounded-lg px-3 text-[12px] font-medium transition-colors ${isActive ? "bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-400/15" : "text-slate-400 hover:bg-white/[.04] hover:text-slate-200"} ${collapsed ? "justify-center px-0" : ""}`}>
                <Icon size={16} strokeWidth={1.8} />{!collapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className={`mt-auto border-t border-white/[.07] p-3 ${collapsed ? "text-center" : ""}`}>
          {!collapsed && <div className="mb-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3"><div className="mb-1 flex items-center gap-2 text-[11px] font-semibold"><span className={`h-1.5 w-1.5 rounded-full ${healthError ? "bg-rose-400" : health.data_available ? "bg-emerald-400" : "bg-amber-400"}`} />Data connection</div><p className="text-[10px] leading-relaxed text-slate-500">{healthError || (health.data_available ? "Curated historical data connected" : "Waiting for source datasets")}</p><p className="mt-1 text-[9px] text-slate-600">{health.model_available ? "LightGBM forecast model ready" : "Forecast pipeline unavailable"}</p></div>}
          <button onClick={() => setCollapsed(!collapsed)} className="hidden w-full items-center justify-center gap-2 rounded-lg py-2 text-slate-500 hover:bg-white/[.04] hover:text-slate-300 lg:flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span className="text-[11px]">Collapse sidebar</span></>}</button>
          {!collapsed && <div className="flex items-center gap-2 px-2 pt-2 text-[10px] text-slate-600"><Settings2 size={13} /> NEXUS Analytics · Demo</div>}
        </div>
      </aside>

      <main className={`min-h-screen transition-[margin] duration-200 ${collapsed ? "lg:ml-[76px]" : "lg:ml-[252px]"}`}>
        <Header title={titles[location.pathname] ?? "Demand Intelligence"} filters={filters} setFilters={setFilters} onMenu={() => setMobileOpen(true)} health={health} healthError={healthError} />
        <div className="mx-auto max-w-[1600px] px-4 pb-10 pt-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .16 }}>
              <Routes>
                <Route path="/" element={<Overview filters={filters} />} />
                <Route path="/sales" element={<SalesAnalytics filters={filters} />} />
                <Route path="/products" element={<ProductAnalytics filters={filters} />} />
                <Route path="/stores" element={<StoreAnalytics filters={filters} />} />
                <Route path="/forecasting" element={<Forecasting />} />
                <Route path="/inventory" element={<InventoryPlanning filters={filters} />} />
                <Route path="/risks" element={<RiskMonitoring filters={filters} />} />
                <Route path="/data" element={<DataExplorer />} />
                <Route path="/add-data" element={<AddData />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-white/[.06] pt-4 text-[10px] text-slate-600"><span>NEXUS Demand Intelligence</span><span>Insights are computed from the selected source data · No external AI service</span></footer>
        </div>
      </main>
    </div>
  );
}

function Header({ title, filters, setFilters, onMenu, health, healthError }: { title: string; filters: GlobalFilters; setFilters: (next: GlobalFilters) => void; onMenu: () => void; health: { status?: string; data_available?: boolean; date_range?: { start: string; end: string } | null }; healthError: string }) {
  const [stores, setStores] = useState<string[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [optionsError, setOptionsError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([getDataset("stores", { pageSize: 500 }), getDataset("products", { pageSize: 500 })])
      .then(([storeData, productData]) => {
        if (!active) return;
        setStores(storeData.records.map((r) => String(r.store_nbr ?? "")).filter(Boolean));
        setFamilies([...new Set(productData.records.map((r) => String(r.family ?? "")).filter(Boolean))]);
        setOptionsError("");
      })
      .catch(() => { if (active) setOptionsError("Filter options unavailable"); });
    return () => { active = false; };
  }, []);

  const updatePeriod = (value: string) => {
    if (value === "all") { setFilters({ ...filters, start: undefined, end: undefined }); return; }
    const periodEnd = health.date_range?.end ?? new Date().toISOString().slice(0, 10);
    const start = new Date(`${periodEnd}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - Number(value) + 1);
    setFilters({ ...filters, start: start.toISOString().slice(0, 10), end: periodEnd });
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/[.07] bg-[#0b1020]/90 backdrop-blur-xl">
      <div className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3"><button onClick={onMenu} aria-label="Open navigation" className="rounded-lg p-2 text-slate-400 hover:bg-white/[.05] lg:hidden"><Menu size={18} /></button><div><div className="text-[10px] font-semibold uppercase tracking-[.17em] text-slate-500">NEXUS / Analytics</div><h1 className="mt-0.5 font-[Manrope] text-[17px] font-bold tracking-tight text-slate-100">{title}</h1></div></div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.025] px-2.5 text-[11px] text-slate-300"><span className="text-slate-500">Period</span><select defaultValue="all" onChange={(e) => updatePeriod(e.target.value)} className="max-w-[94px] bg-transparent outline-none"><option value="all">All time</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">12 months</option></select><ChevronDown size={12} className="text-slate-500" /></label>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.025] px-2.5 text-[11px] text-slate-300"><span className="text-slate-500">Store</span><select value={filters.store ?? ""} onChange={(e) => setFilters({ ...filters, store: e.target.value || undefined })} className="max-w-[75px] bg-transparent outline-none sm:max-w-[100px]"><option value="">All stores</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.025] px-2.5 text-[11px] text-slate-300"><span className="text-slate-500">Family</span><select value={filters.family ?? ""} onChange={(e) => setFilters({ ...filters, family: e.target.value || undefined })} className="max-w-[95px] bg-transparent outline-none sm:max-w-[130px]"><option value="">All families</option>{families.map((family) => <option key={family} value={family}>{family}</option>)}</select></label>
          <div className="flex h-9 items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.025] px-2.5 text-[10px] text-slate-400" title={healthError || optionsError || (health.data_available ? "Source data detected" : "No source datasets detected")}><span className={`h-1.5 w-1.5 rounded-full ${healthError ? "bg-rose-400" : health.data_available ? "bg-emerald-400" : "bg-amber-400"}`} />{healthError || (health.data_available ? "Connected" : optionsError || "No data")}</div>
        </div>
      </div>
    </header>
  );
}
