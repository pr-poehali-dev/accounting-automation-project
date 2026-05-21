import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type TaxReport } from "@/lib/api";

const MONTH_RANGES: Record<string, { label: string; from: string; to: string }> = {
  "Q1": { label: "Январь — Март", from: "-01-01", to: "-03-31" },
  "Q2": { label: "Апрель — Июнь", from: "-04-01", to: "-06-30" },
  "Q3": { label: "Июль — Сентябрь", from: "-07-01", to: "-09-30" },
  "Q4": { label: "Октябрь — Декабрь", from: "-10-01", to: "-12-31" },
};

export default function TaxReports() {
  const [reports, setReports] = useState<TaxReport[]>([]);
  const [summary, setSummary] = useState({ income: 0, expense: 0, tax_base: 0, vat: 0 });
  const [loading, setLoading] = useState(true);
  const [periodType, setPeriodType] = useState<"quarter" | "year" | "custom">("quarter");
  const [quarter, setQuarter] = useState("Q2");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    Promise.all([
      api.taxReports.list(),
      api.taxReports.summary(),
    ]).then(([reportsRes, summaryRes]) => {
      setReports(reportsRes.reports);
      setSummary(summaryRes);
    }).finally(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerated(false);

    let dateFrom = "";
    let dateTo = "";
    let periodLabel = "";
    let name = "";

    if (periodType === "quarter") {
      const range = MONTH_RANGES[quarter];
      dateFrom = year + range.from;
      dateTo = year + range.to;
      periodLabel = `${range.label} ${year}`;
      name = `Налоговый отчёт ${quarter} ${year}`;
    } else if (periodType === "year") {
      dateFrom = `${year}-01-01`;
      dateTo = `${year}-12-31`;
      periodLabel = `Январь — Декабрь ${year}`;
      name = `Годовой отчёт ${year}`;
    } else {
      dateFrom = customFrom;
      dateTo = customTo;
      periodLabel = `${customFrom} — ${customTo}`;
      name = `Отчёт за период ${periodLabel}`;
    }

    // Get summary for selected period
    const periodSummary = await api.taxReports.summary({ date_from: dateFrom, date_to: dateTo });
    setSummary(periodSummary);

    // Save report record
    const res = await api.taxReports.create({
      name,
      period: periodLabel,
      report_type: periodType === "year" ? "Годовой" : periodType === "quarter" ? "Квартальный" : "Произвольный",
      status: "Готов",
      size_label: "—",
    });
    setReports((prev) => [res.report, ...prev]);
    setGenerating(false);
    setGenerated(true);
    setTimeout(() => setGenerated(false), 4000);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить отчёт?")) return;
    await api.taxReports.delete(id);
    setReports((prev) => prev.filter((r) => r.id !== id));
  };

  const summaryItems = [
    { label: "Доходы за период", value: fmt(summary.income), icon: "TrendingUp", color: "text-positive" },
    { label: "Расходы за период", value: fmt(summary.expense), icon: "TrendingDown", color: "text-negative" },
    { label: "Налогооблагаемая база", value: fmt(summary.tax_base), icon: "Calculator", color: "text-gold" },
    { label: "НДС 20% (оценка)", value: fmt(summary.vat), icon: "Receipt", color: "text-foreground" },
  ];

  const fDate = (d: string) => new Date(d).toLocaleDateString("ru-RU");

  return (
    <div className="animate-fade-in space-y-4">
      {/* Summary widgets */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {summaryItems.map((item, i) => (
          <div key={i} className="card-fin p-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon name={item.icon} size={14} className={item.color} />
              <span className="text-xs text-muted-foreground leading-tight">{item.label}</span>
            </div>
            {loading ? (
              <div className="h-6 bg-secondary/60 rounded animate-pulse w-2/3" />
            ) : (
              <div className={`font-mono-fin text-base sm:text-lg font-semibold ${item.color}`}>{item.value}</div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Generate form */}
        <div className="lg:col-span-2 card-fin p-4 sm:p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
            Сформировать отчёт
          </div>

          <div className="flex gap-1 mb-4 p-1 bg-secondary rounded-lg">
            {(["quarter", "year", "custom"] as const).map((t) => (
              <button key={t} onClick={() => setPeriodType(t)}
                className={`flex-1 py-1.5 text-xs rounded transition-all ${periodType === t ? "bg-gold text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}>
                {t === "quarter" ? "Квартал" : t === "year" ? "Год" : "Период"}
              </button>
            ))}
          </div>

          {periodType === "quarter" && (
            <div className="flex gap-2 mb-4">
              <select value={quarter} onChange={(e) => setQuarter(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                <option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option>
              </select>
              <select value={year} onChange={(e) => setYear(e.target.value)}
                className="flex-1 bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                {[2026, 2025, 2024].map((y) => <option key={y}>{y}</option>)}
              </select>
            </div>
          )}

          {periodType === "year" && (
            <select value={year} onChange={(e) => setYear(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold mb-4">
              {[2026, 2025, 2024].map((y) => <option key={y}>{y}</option>)}
            </select>
          )}

          {periodType === "custom" && (
            <div className="flex flex-col gap-2 mb-4">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
            </div>
          )}

          <button onClick={handleGenerate} disabled={generating}
            className="w-full py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {generating
              ? <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />Считается...</>
              : <><Icon name="BarChart2" size={15} />Сформировать отчёт</>}
          </button>

          {generated && (
            <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-green-900/20 border border-green-900/30 text-positive text-xs animate-fade-in">
              <Icon name="CheckCircle" size={14} /> Отчёт сформирован и сохранён в архив
            </div>
          )}
        </div>

        {/* Archive */}
        <div className="lg:col-span-3 card-fin overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Архив отчётов</span>
            <span className="text-xs text-muted-foreground font-mono-fin">{reports.length} шт.</span>
          </div>
          {loading ? (
            <div className="divide-y divide-border/50">
              {Array(3).fill(0).map((_, i) => (
                <div key={i} className="px-5 py-4 flex gap-4 animate-pulse">
                  <div className="w-9 h-9 rounded-lg bg-secondary flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-secondary rounded w-2/3" />
                    <div className="h-3 bg-secondary rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : reports.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <Icon name="FileText" size={28} className="mx-auto mb-2 opacity-40" />
              Отчётов нет. Сформируйте первый.
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {reports.map((r) => (
                <div key={r.id} className="px-5 py-4 flex items-center gap-4 hover-row">
                  <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                    <Icon name="FileText" size={16} className="text-gold" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.period} • {fDate(r.created_at)}</div>
                  </div>
                  <span className="hidden sm:block text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground flex-shrink-0">{r.report_type}</span>
                  <span className="text-xs text-positive bg-green-900/20 px-2 py-0.5 rounded-full flex-shrink-0">{r.status}</span>
                  <button onClick={() => handleDelete(r.id)}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-negative hover:bg-red-900/20 transition-colors flex-shrink-0">
                    <Icon name="Trash2" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
