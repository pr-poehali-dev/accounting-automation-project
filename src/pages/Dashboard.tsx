import { useEffect, useState, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type DashboardSummary } from "@/lib/api";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_KEY = "dashboard_quarters_year";
const CHART_YEAR_KEY = "dashboard_chart_year";

function getQuarterDates(year: number, q: 1 | 2 | 3 | 4) {
  const ranges = { 1: ["01-01", "03-31"], 2: ["04-01", "06-30"], 3: ["07-01", "09-30"], 4: ["10-01", "12-31"] };
  const [from, to] = ranges[q];
  return { date_from: `${year}-${from}`, date_to: `${year}-${to}` };
}

interface QuarterData { income: number; expense: number; loading: boolean; }
type QuartersState = [QuarterData, QuarterData, QuarterData, QuarterData];
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

interface TooltipEntry { name: string; color: string; value: number; }
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="card-fin p-3 text-xs font-mono-fin">
        <div className="text-muted-foreground mb-2">{label}</div>
        {payload.map((p) => (
          <div key={p.name} style={{ color: p.color }} className="flex gap-4 justify-between">
            <span>{p.name}</span>
            <span>{fmt(p.value)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const quickActions = [
  { label: "Новая операция", icon: "Plus", section: "transactions" },
  { label: "Загрузить документ", icon: "Upload", section: "documents" },
  { label: "Сформировать отчёт", icon: "FileText", section: "taxes" },
  { label: "Спросить ИИ", icon: "MessageSquare", section: "chat" },
];

interface Props {
  onNavigate?: (section: string) => void;
}

export default function Dashboard({ onNavigate }: Props) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartYear, setChartYear] = useState<number>(() => {
    const saved = localStorage.getItem(CHART_YEAR_KEY);
    return saved ? parseInt(saved, 10) : CURRENT_YEAR;
  });

  const [quarterYear, setQuarterYear] = useState<number>(() => {
    const saved = localStorage.getItem(YEAR_KEY);
    return saved ? parseInt(saved, 10) : CURRENT_YEAR;
  });
  const emptyQ = (): QuarterData => ({ income: 0, expense: 0, loading: true });
  const [quarters, setQuarters] = useState<QuartersState>([emptyQ(), emptyQ(), emptyQ(), emptyQ()]);

  const loadQuarters = useCallback(async (year: number) => {
    setQuarters([emptyQ(), emptyQ(), emptyQ(), emptyQ()]);
    const results = await Promise.all(
      ([1, 2, 3, 4] as const).map((q) => api.taxReports.summary(getQuarterDates(year, q)))
    );
    setQuarters(results.map((r) => ({ income: r.income, expense: r.expense, loading: false })) as QuartersState);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.transactions.summary(chartYear)
      .then(setData)
      .finally(() => setLoading(false));
  }, [chartYear]);

  const handleChartYearChange = (year: number) => {
    setChartYear(year);
    localStorage.setItem(CHART_YEAR_KEY, String(year));
  };

  useEffect(() => {
    loadQuarters(quarterYear);
  }, [quarterYear, loadQuarters]);

  const handleYearChange = (year: number) => {
    setQuarterYear(year);
    localStorage.setItem(YEAR_KEY, String(year));
  };

  const widgets = data
    ? [
        { label: "Общий баланс", value: fmt(data.balance), icon: "Wallet", sub: "все время" },
        { label: "Доходы (месяц)", value: fmt(data.income_month), icon: "TrendingUp", sub: "текущий месяц" },
        { label: "Расходы (месяц)", value: fmt(data.expense_month), icon: "TrendingDown", sub: "текущий месяц" },
        { label: "Прибыль (месяц)", value: fmt(data.profit_month), icon: "BarChart2", sub: "доходы − расходы" },
      ]
    : Array(4).fill(null);

  return (
    <div className="animate-fade-in space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {widgets.map((w, i) => (
          <div key={i} className="card-fin p-3 sm:p-5 flex flex-col gap-2 sm:gap-3">
            {loading || !w ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-3 bg-secondary rounded w-2/3" />
                <div className="h-6 bg-secondary rounded w-3/4" />
                <div className="h-3 bg-secondary rounded w-1/2" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-[10px] sm:text-xs uppercase tracking-wider sm:tracking-widest line-clamp-1">{w.label}</span>
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--surface-raised))" }}>
                    <Icon name={w.icon} size={14} className="text-gold" />
                  </div>
                </div>
                <div className="font-mono-fin text-base sm:text-xl font-semibold break-all">{w.value}</div>
                <div className="text-muted-foreground text-[10px] sm:text-xs">{w.sub}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card-fin p-3 sm:p-5 xl:col-span-2">
          <div className="flex items-start sm:items-center justify-between gap-2 mb-4 sm:mb-5 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs uppercase tracking-wider sm:tracking-widest text-muted-foreground">Динамика</div>
              <div className="text-sm font-medium mt-0.5 flex items-center gap-2">
                Доходы и расходы —
                <div className="flex items-center gap-1">
                  <button onClick={() => handleChartYearChange(chartYear - 1)}
                    className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                    <Icon name="ChevronLeft" size={13} />
                  </button>
                  <span className="font-mono-fin text-gold min-w-[36px] text-center">{chartYear}</span>
                  <button onClick={() => handleChartYearChange(chartYear + 1)}
                    disabled={chartYear >= CURRENT_YEAR}
                    className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    <Icon name="ChevronRight" size={13} />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 sm:gap-4 text-[10px] sm:text-xs text-muted-foreground flex-shrink-0">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gold inline-block" />Доход</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Расход</span>
            </div>
          </div>
          {loading ? (
            <div className="h-[220px] bg-secondary/30 animate-pulse rounded" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data?.chart ?? []} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(43,74%,56%)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(43,74%,56%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(0,72%,51%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(0,72%,51%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: "IBM Plex Mono", fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => v === 0 ? "0" : `${(v / 1000000).toFixed(1)}М`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="доход" stroke="hsl(43,74%,56%)" strokeWidth={2} fill="url(#gradIncome)" />
                <Area type="monotone" dataKey="расход" stroke="hsl(0,72%,51%)" strokeWidth={2} fill="url(#gradExpense)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-fin p-3 sm:p-5">
          <div className="text-[10px] sm:text-xs uppercase tracking-wider sm:tracking-widest text-muted-foreground mb-1">Расходы по статьям</div>
          <div className="text-sm font-medium mb-4 sm:mb-5">Структура затрат</div>
          {loading ? (
            <div className="h-[220px] bg-secondary/30 animate-pulse rounded" />
          ) : data?.categories && data.categories.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.categories} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => v === 0 ? "0" : `${(v / 1000000).toFixed(1)}М`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fontFamily: "IBM Plex Sans", fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="сумма" fill="hsl(43,74%,56%)" radius={[0, 3, 3, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Icon name="PieChart" size={28} />
              <div className="text-xs text-center">Данных пока нет.<br />Добавьте расходные операции.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Квартальный обзор ── */}
      <div className="card-fin p-3 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-[10px] sm:text-xs uppercase tracking-wider sm:tracking-widest text-muted-foreground">Кварталы</div>
            <div className="text-sm font-medium mt-0.5">Доходы и расходы по кварталам</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => handleYearChange(quarterYear - 1)} className="w-7 h-7 rounded flex items-center justify-center hover:bg-secondary transition-colors">
              <Icon name="ChevronLeft" size={15} className="text-muted-foreground" />
            </button>
            <span className="font-mono-fin text-sm font-medium w-12 text-center">{quarterYear}</span>
            <button onClick={() => handleYearChange(quarterYear + 1)} disabled={quarterYear >= CURRENT_YEAR} className="w-7 h-7 rounded flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-30">
              <Icon name="ChevronRight" size={15} className="text-muted-foreground" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(["I кв.", "II кв.", "III кв.", "IV кв."] as const).map((label, i) => {
            const q = quarters[i];
            const profit = q.income - q.expense;
            return (
              <div key={i} className="card-fin-raised rounded-xl p-3 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
                  <span className={`text-[10px] font-mono-fin font-medium ${profit >= 0 ? "text-gold" : "text-red-400"}`}>
                    {q.loading ? "…" : (profit >= 0 ? "+" : "") + fmt(profit)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-gold inline-block" />Доход</span>
                    <span className="font-mono-fin">{q.loading ? <span className="inline-block w-12 h-3 bg-secondary rounded animate-pulse" /> : fmt(q.income)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Расход</span>
                    <span className="font-mono-fin">{q.loading ? <span className="inline-block w-12 h-3 bg-secondary rounded animate-pulse" /> : fmt(q.expense)}</span>
                  </div>
                </div>
                {!q.loading && (q.income > 0 || q.expense > 0) && (
                  <div className="h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gold rounded-full transition-all"
                      style={{ width: `${Math.min(100, q.income / Math.max(q.income, q.expense) * 100)}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card-fin p-3 sm:p-5">
        <div className="text-[10px] sm:text-xs uppercase tracking-wider sm:tracking-widest text-muted-foreground mb-3 sm:mb-4">Быстрые действия</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {quickActions.map((a, i) => (
            <button key={i}
              onClick={() => onNavigate?.(a.section)}
              className="flex items-center gap-2 sm:gap-3 card-fin-raised px-3 sm:px-4 py-3 rounded hover:border-gold/40 border border-transparent transition-all duration-150 text-left group">
              <div className="w-8 h-8 rounded flex items-center justify-center bg-gold/10 group-hover:bg-gold/20 transition-colors flex-shrink-0">
                <Icon name={a.icon} size={15} className="text-gold" />
              </div>
              <span className="text-xs sm:text-sm text-foreground/80 group-hover:text-foreground transition-colors leading-tight">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}