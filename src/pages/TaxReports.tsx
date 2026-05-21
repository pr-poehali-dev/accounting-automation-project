import { useState } from "react";
import Icon from "@/components/ui/icon";

const reports = [
  { id: "R-2026-Q1", name: "Налоговый отчёт Q1 2026", period: "Январь — Март 2026", type: "Квартальный", status: "Готов", size: "2.4 МБ", created: "05.04.2026" },
  { id: "R-2025-Q4", name: "Налоговый отчёт Q4 2025", period: "Октябрь — Декабрь 2025", type: "Квартальный", status: "Готов", size: "2.1 МБ", created: "10.01.2026" },
  { id: "R-2025-ANN", name: "Годовой отчёт 2025", period: "Январь — Декабрь 2025", type: "Годовой", status: "Готов", size: "8.7 МБ", created: "20.01.2026" },
  { id: "R-2025-Q3", name: "Налоговый отчёт Q3 2025", period: "Июль — Сентябрь 2025", type: "Квартальный", status: "Готов", size: "1.9 МБ", created: "05.10.2025" },
];

const summaryItems = [
  { label: "Доходы за период", value: "₽ 68 500 000", icon: "TrendingUp", color: "text-positive" },
  { label: "Расходы за период", value: "₽ 41 200 000", icon: "TrendingDown", color: "text-negative" },
  { label: "Налогооблагаемая база", value: "₽ 27 300 000", icon: "Calculator", color: "text-gold" },
  { label: "НДС к уплате", value: "₽ 4 550 000", icon: "Receipt", color: "text-foreground" },
];

export default function TaxReports() {
  const [periodType, setPeriodType] = useState<"quarter" | "year" | "custom">("quarter");
  const [quarter, setQuarter] = useState("Q2");
  const [year, setYear] = useState("2026");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const handleGenerate = () => {
    setGenerating(true);
    setGenerated(false);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 2500);
  };

  return (
    <div className="animate-fade-in space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryItems.map((item, i) => (
          <div key={i} className="card-fin p-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon name={item.icon} size={14} className={item.color} />
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
            <div className={`font-mono-fin text-lg font-semibold ${item.color}`}>{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 card-fin p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Сформировать отчёт</div>

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
                <option>2026</option><option>2025</option><option>2024</option>
              </select>
            </div>
          )}

          {periodType === "year" && (
            <select value={year} onChange={(e) => setYear(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold mb-4">
              <option>2026</option><option>2025</option><option>2024</option>
            </select>
          )}

          {periodType === "custom" && (
            <div className="flex flex-col gap-2 mb-4">
              <input type="date" className="bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
              <input type="date" className="bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
            </div>
          )}

          <div className="mb-4">
            <div className="text-xs text-muted-foreground mb-2">Формат выгрузки</div>
            <div className="flex gap-2">
              {["PDF", "Excel", "ZIP"].map((f) => (
                <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" defaultChecked={f === "PDF"} className="rounded accent-yellow-500" />
                  <span className="text-sm">{f}</span>
                </label>
              ))}
            </div>
          </div>

          <button onClick={handleGenerate} disabled={generating}
            className="w-full py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {generating ? (
              <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />Формируется...</>
            ) : (
              <><Icon name="Download" size={15} />Сформировать и скачать</>
            )}
          </button>

          {generated && (
            <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-green-900/20 border border-green-900/30 text-positive text-xs animate-fade-in">
              <Icon name="CheckCircle" size={14} />
              Отчёт готов! Начинается загрузка...
            </div>
          )}
        </div>

        <div className="lg:col-span-3 card-fin overflow-hidden">
          <div className="px-5 py-4 border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
            Архив отчётов
          </div>
          <div className="divide-y divide-border/50">
            {reports.map((r) => (
              <div key={r.id} className="px-5 py-4 flex items-center gap-4 hover-row">
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                  <Icon name="FileText" size={16} className="text-gold" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.period} • {r.size}</div>
                </div>
                <div className="hidden sm:block">
                  <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">{r.type}</span>
                </div>
                <span className="text-xs text-positive bg-green-900/20 px-2 py-0.5 rounded-full">{r.status}</span>
                <div className="flex gap-1">
                  <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-gold hover:bg-gold/10 transition-colors">
                    <Icon name="Download" size={13} />
                  </button>
                  <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                    <Icon name="Eye" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
