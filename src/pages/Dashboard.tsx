import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type DashboardSummary } from "@/lib/api";
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

  useEffect(() => {
    api.transactions.summary()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const widgets = data
    ? [
        { label: "Общий баланс", value: fmt(data.balance), icon: "Wallet", sub: "все время" },
        { label: "Доходы (месяц)", value: fmt(data.income_month), icon: "TrendingUp", sub: "текущий месяц" },
        { label: "Расходы (месяц)", value: fmt(data.expense_month), icon: "TrendingDown", sub: "текущий месяц" },
        { label: "Прибыль (месяц)", value: fmt(data.profit_month), icon: "BarChart2", sub: "доходы − расходы" },
      ]
    : Array(4).fill(null);

  return (
    <div className="animate-fade-in space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {widgets.map((w, i) => (
          <div key={i} className="card-fin p-5 flex flex-col gap-3">
            {loading || !w ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-3 bg-secondary rounded w-2/3" />
                <div className="h-6 bg-secondary rounded w-3/4" />
                <div className="h-3 bg-secondary rounded w-1/2" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs uppercase tracking-widest">{w.label}</span>
                  <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: "hsl(var(--surface-raised))" }}>
                    <Icon name={w.icon} size={15} className="text-gold" />
                  </div>
                </div>
                <div className="font-mono-fin text-xl font-semibold">{w.value}</div>
                <div className="text-muted-foreground text-xs">{w.sub}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card-fin p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Динамика</div>
              <div className="text-sm font-medium mt-0.5">Доходы и расходы — {new Date().getFullYear()}</div>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
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

        <div className="card-fin p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Расходы по статьям</div>
          <div className="text-sm font-medium mb-5">Структура затрат</div>
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

      <div className="card-fin p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Быстрые действия</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map((a, i) => (
            <button key={i}
              onClick={() => onNavigate?.(a.section)}
              className="flex items-center gap-3 card-fin-raised px-4 py-3 rounded hover:border-gold/40 border border-transparent transition-all duration-150 text-left group">
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
