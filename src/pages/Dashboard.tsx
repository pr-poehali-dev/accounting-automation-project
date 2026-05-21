
import Icon from "@/components/ui/icon";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

const areaData = [
  { month: "Янв", доход: 4200000, расход: 2800000 },
  { month: "Фев", доход: 3800000, расход: 3100000 },
  { month: "Мар", доход: 5100000, расход: 2600000 },
  { month: "Апр", доход: 4700000, расход: 3400000 },
  { month: "Май", доход: 6200000, расход: 3900000 },
  { month: "Июн", доход: 5800000, расход: 3200000 },
  { month: "Июл", доход: 7100000, расход: 4100000 },
  { month: "Авг", доход: 6600000, расход: 3700000 },
  { month: "Сен", доход: 7800000, расход: 4300000 },
  { month: "Окт", доход: 8200000, расход: 4600000 },
  { month: "Ноя", доход: 7400000, расход: 4200000 },
  { month: "Дек", доход: 9100000, расход: 5100000 },
];

const categoryData = [
  { name: "Маркетинг", сумма: 1240000 },
  { name: "Зарплаты", сумма: 3800000 },
  { name: "Аренда", сумма: 520000 },
  { name: "Оборудование", сумма: 890000 },
  { name: "Логистика", сумма: 670000 },
  { name: "Прочее", сумма: 380000 },
];

const fmt = (n: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);

interface TooltipEntry { name: string; color: string; value: number; }
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="card-fin p-3 text-xs font-mono-fin">
        <div className="text-muted-foreground mb-2">{label}</div>
        {payload.map((p: TooltipEntry) => (
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

const widgets = [
  { label: "Общий баланс", value: "₽ 47 382 500", delta: "+12.4%", positive: true, icon: "Wallet", sub: "на 21 мая 2026" },
  { label: "Доходы (май)", value: "₽ 9 100 000", delta: "+23.1%", positive: true, icon: "TrendingUp", sub: "vs апрель" },
  { label: "Расходы (май)", value: "₽ 5 100 000", delta: "+8.6%", positive: false, icon: "TrendingDown", sub: "vs апрель" },
  { label: "Чистая прибыль", value: "₽ 4 000 000", delta: "+41.3%", positive: true, icon: "BarChart2", sub: "май 2026" },
];

const quickActions = [
  { label: "Новая операция", icon: "Plus" },
  { label: "Загрузить документ", icon: "Upload" },
  { label: "Сформировать отчёт", icon: "FileText" },
  { label: "Спросить ИИ", icon: "MessageSquare" },
];

export default function Dashboard() {
  return (
    <div className="animate-fade-in space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {widgets.map((w, i) => (
          <div key={i} className="card-fin p-5 flex flex-col gap-3" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs uppercase tracking-widest">{w.label}</span>
              <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: "hsl(var(--surface-raised))" }}>
                <Icon name={w.icon} size={15} className="text-gold" />
              </div>
            </div>
            <div className="font-mono-fin text-xl font-semibold">{w.value}</div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono-fin px-1.5 py-0.5 rounded ${w.positive ? "text-positive bg-green-900/20" : "text-negative bg-red-900/20"}`}>
                {w.delta}
              </span>
              <span className="text-muted-foreground text-xs">{w.sub}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card-fin p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Динамика</div>
              <div className="text-sm font-medium mt-0.5">Доходы и расходы — 2026</div>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gold inline-block" />Доход</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Расход</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={areaData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
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
              <YAxis tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}М`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="доход" stroke="hsl(43,74%,56%)" strokeWidth={2} fill="url(#gradIncome)" />
              <Area type="monotone" dataKey="расход" stroke="hsl(0,72%,51%)" strokeWidth={2} fill="url(#gradExpense)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card-fin p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Расходы по статьям</div>
          <div className="text-sm font-medium mb-5">Структура затрат</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fontFamily: "IBM Plex Mono", fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}М`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fontFamily: "IBM Plex Sans", fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={80} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="сумма" fill="hsl(43,74%,56%)" radius={[0, 3, 3, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card-fin p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Быстрые действия</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map((a, i) => (
            <button key={i} className="flex items-center gap-3 card-fin-raised px-4 py-3 rounded hover:border-gold/40 border border-transparent transition-all duration-150 text-left group">
              <div className="w-8 h-8 rounded flex items-center justify-center bg-gold/10 group-hover:bg-gold/20 transition-colors">
                <Icon name={a.icon} size={15} className="text-gold" />
              </div>
              <span className="text-sm text-foreground/80 group-hover:text-foreground transition-colors">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}