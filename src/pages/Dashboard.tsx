import { useEffect, useState, useCallback, useRef } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type DashboardSummary } from "@/lib/api";

const BANNERS = [
  {
    img: "https://cdn.poehali.dev/projects/c9681124-9e6c-427c-98d2-241fbe701153/files/e7b21a8b-6a13-4499-8813-0c6f8361e390.jpg",
    tag: "Butsky Group",
    title: "Команда профессионалов\nна страже вашего учёта",
    sub: "Интеллектуальная автоматизация учёта, созданная экспертом",
    emblem: "flag",
    imgPos: "center 30%",
  },
  {
    img: "https://cdn.poehali.dev/projects/c9681124-9e6c-427c-98d2-241fbe701153/files/40fb5983-5ead-4755-bd67-d8b3b24f4c48.jpg",
    tag: "Бухучёт с телефона",
    title: "Сфотографировал —\nдокумент уже в системе",
    sub: "ИИ распознаёт накладные, чеки и счета за секунды",
    emblem: "flag",
    imgPos: "center 25%",
  },
  {
    img: "https://cdn.poehali.dev/projects/c9681124-9e6c-427c-98d2-241fbe701153/files/21d744fc-102d-4f89-9c13-1bba5d829503.jpg",
    tag: "Автоматический расчёт",
    title: "Налоги и отчёты\nсчитаются сами",
    sub: "Полная налоговая отчётность формируется в один клик",
    emblem: "coa",
    imgPos: "center 20%",
  },
  {
    img: "https://cdn.poehali.dev/projects/c9681124-9e6c-427c-98d2-241fbe701153/files/4e07e443-2aee-4874-9dbe-9a6f3732e740.jpg",
    tag: "Простота и надёжность",
    title: "Максимальная простота\nфинансового учёта",
    sub: "Авторская программа — надёжно, быстро, без лишнего",
    emblem: "coa",
    imgPos: "center top",
  },
  {
    img: "",
    tag: "Финансовые технологии",
    title: "Butsky Group",
    sub: "Авторская программа бухгалтерского учёта",
    emblem: "brand",
  },
];

function HeroBanner() {
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = (idx: number) => {
    if (animating || idx === current) return;
    setAnimating(true);
    setTimeout(() => {
      setCurrent(idx);
      setAnimating(false);
    }, 300);
  };

  const next = useCallback(() => {
    goTo((current + 1) % BANNERS.length);
  }, [current, animating]);

  useEffect(() => {
    timerRef.current = setInterval(next, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [next]);

  const b = BANNERS[current];

  return (
    <div className="relative w-full overflow-hidden rounded-xl" style={{ height: "220px" }}>
      {/* Background image */}
      {b.img ? (
        <div
          className="absolute inset-0 bg-cover transition-opacity duration-300"
          style={{
            backgroundImage: `url(${b.img})`,
            backgroundPosition: (b as { imgPos?: string }).imgPos || "center center",
            opacity: animating ? 0 : 1,
          }}
        />
      ) : (
        /* Брендовый фон — градиент без фото */
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{
            background: "linear-gradient(135deg, #0F172A 0%, #0c1f3a 50%, #0F172A 100%)",
            opacity: animating ? 0 : 1,
          }}
        >
          {/* Декоративная сетка */}
          <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#0284C7" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          {/* Центральный логотип BG */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 transition-opacity duration-300"
            style={{ opacity: animating ? 0 : 1 }}
          >
            <div className="flex items-center gap-4">
              <svg width="64" height="64" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"
                style={{ filter: "drop-shadow(0 0 16px rgba(2,132,199,0.5))" }}>
                <polygon points="18,2 33,10 33,26 18,34 3,26 3,10" fill="#0F172A" stroke="#0284C7" strokeWidth="1.5"/>
                <text x="18" y="23" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="12" fill="#ffffff" letterSpacing="-0.5">BG</text>
              </svg>
              <div className="text-left">
                <div className="text-3xl font-bold text-white tracking-tight leading-none">Butsky Group</div>
                <div className="text-[#0284C7] text-sm font-medium tracking-widest mt-1">ФИНАНСОВЫЕ ТЕХНОЛОГИИ</div>
              </div>
            </div>
            <div className="text-white/50 text-xs tracking-wider text-center max-w-xs">
              Авторская программа бухгалтерского учёта
            </div>
            {/* Декоративная линия */}
            <div className="flex items-center gap-3">
              <div className="h-px w-16 bg-[#0284C7]/40" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#0284C7]" />
              <div className="h-px w-16 bg-[#0284C7]/40" />
            </div>
          </div>
        </div>
      )}
      {/* Gradient overlay — только для баннеров с фото */}
      {b.img && (
        <>
          <div className="absolute inset-0 bg-gradient-to-r from-[#0F172A]/90 via-[#0F172A]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A]/70 via-transparent to-transparent" />
        </>
      )}

      {/* Флаг / Герб России — правый верхний угол */}
      <div
        className="absolute top-4 right-4 z-10 transition-opacity duration-300"
        style={{ opacity: animating ? 0 : 1 }}
      >
        {b.emblem === "flag" && (
          <div className="flex flex-col overflow-hidden rounded shadow-lg" style={{ width: 38, height: 26 }}>
            <div style={{ flex: 1, background: "#FFFFFF" }} />
            <div style={{ flex: 1, background: "#0039A6" }} />
            <div style={{ flex: 1, background: "#D52B1E" }} />
          </div>
        )}
        {b.emblem === "coa" && (
          <div
            className="rounded overflow-hidden shadow-lg"
            style={{ width: 44, height: 44, background: "#000" }}
          >
            <img
              src="https://cdn.poehali.dev/projects/c9681124-9e6c-427c-98d2-241fbe701153/files/227b28b7-cfae-444a-8fbe-aad15fffab8e.jpg"
              alt="Герб России"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        )}
      </div>

      {/* Content — только для баннеров с фото */}
      {b.img && (
        <div
          className="relative z-10 h-full flex flex-col justify-end p-5 sm:p-7 transition-opacity duration-300"
          style={{ opacity: animating ? 0 : 1 }}
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-[#0284C7] uppercase mb-2">
            <span className="w-1 h-1 rounded-full bg-[#0284C7]" />
            {b.tag}
          </span>
          <h2 className="text-lg sm:text-2xl font-bold text-white leading-tight mb-1.5 whitespace-pre-line">
            {b.title}
          </h2>
          <p className="text-sm text-white/70 max-w-sm">{b.sub}</p>
        </div>
      )}

      {/* Dots */}
      <div className="absolute bottom-4 right-5 flex gap-1.5 z-10">
        {BANNERS.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className="transition-all duration-300"
            style={{
              width: i === current ? "20px" : "6px",
              height: "6px",
              borderRadius: "3px",
              background: i === current ? "#0284C7" : "rgba(255,255,255,0.35)",
            }}
          />
        ))}
      </div>

      {/* Prev / Next arrows */}
      <button
        onClick={() => goTo((current - 1 + BANNERS.length) % BANNERS.length)}
        className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white transition-all duration-300"
      >
        <Icon name="ChevronLeft" size={14} />
      </button>
      <button
        onClick={() => goTo((current + 1) % BANNERS.length)}
        className="absolute right-14 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center text-white transition-all duration-300"
      >
        <Icon name="ChevronRight" size={14} />
      </button>
    </div>
  );
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_KEY = "dashboard_quarters_year";
const CHART_YEAR_KEY = "dashboard_chart_year";

function getQuarterDates(year: number, q: 1 | 2 | 3 | 4) {
  const ranges = { 1: ["01-01", "03-31"], 2: ["04-01", "06-30"], 3: ["07-01", "09-30"], 4: ["10-01", "12-31"] };
  const [from, to] = ranges[q];
  return { date_from: `${year}-${from}`, date_to: `${year}-${to}` };
}

interface QuarterData { income: number; expense: number; expense_cashless: number; loading: boolean; }
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
  const emptyQ = (): QuarterData => ({ income: 0, expense: 0, expense_cashless: 0, loading: true });
  const [quarters, setQuarters] = useState<QuartersState>([emptyQ(), emptyQ(), emptyQ(), emptyQ()]);

  const loadQuarters = useCallback(async (year: number) => {
    setQuarters([emptyQ(), emptyQ(), emptyQ(), emptyQ()]);
    const results = await Promise.all(
      ([1, 2, 3, 4] as const).map((q) => api.taxReports.summary(getQuarterDates(year, q)))
    );
    setQuarters(results.map((r) => ({ income: r.income, expense: r.expense, expense_cashless: r.expense_cashless ?? 0, loading: false })) as QuartersState);
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
      <HeroBanner />
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
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-[10px] sm:text-xs uppercase tracking-wider sm:tracking-widest text-muted-foreground">Расходы по статьям</div>
            <div className="flex items-center gap-1">
              <button onClick={() => handleChartYearChange(chartYear - 1)}
                className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Icon name="ChevronLeft" size={12} />
              </button>
              <span className="font-mono-fin text-xs text-gold min-w-[34px] text-center">{chartYear}</span>
              <button onClick={() => handleChartYearChange(chartYear + 1)}
                disabled={chartYear >= CURRENT_YEAR}
                className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30">
                <Icon name="ChevronRight" size={12} />
              </button>
            </div>
          </div>
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
                  {(q.loading || q.expense_cashless > 0) && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />Безнал</span>
                      <span className="font-mono-fin text-blue-400">{q.loading ? <span className="inline-block w-12 h-3 bg-secondary rounded animate-pulse" /> : fmt(q.expense_cashless)}</span>
                    </div>
                  )}
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

      {/* ── Безналичный расчёт за год ── */}
      {quarters.some((q) => !q.loading && q.expense_cashless > 0) && (
        <div className="card-fin p-3 sm:p-5 border border-blue-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded flex items-center justify-center bg-blue-500/10 flex-shrink-0">
              <Icon name="CreditCard" size={15} className="text-blue-400" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Безналичный расчёт</div>
              <div className="text-sm font-medium">Расходы по безналу — {quarterYear}</div>
            </div>
            <div className="ml-auto font-mono-fin text-lg font-semibold text-blue-400">
              {fmt(quarters.reduce((s, q) => s + q.expense_cashless, 0))}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(["I кв.", "II кв.", "III кв.", "IV кв."] as const).map((label, i) => (
              <div key={i} className="text-center p-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
                <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
                <div className="font-mono-fin text-xs font-medium text-blue-400">
                  {quarters[i].loading ? "…" : fmt(quarters[i].expense_cashless)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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