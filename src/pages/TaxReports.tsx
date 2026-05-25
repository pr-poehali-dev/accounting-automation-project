import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type TaxReport } from "@/lib/api";

const MONTH_RANGES: Record<string, { label: string; from: string; to: string }> = {
  "Q1": { label: "Январь — Март", from: "-01-01", to: "-03-31" },
  "Q2": { label: "Апрель — Июнь", from: "-04-01", to: "-06-30" },
  "Q3": { label: "Июль — Сентябрь", from: "-07-01", to: "-09-30" },
  "Q4": { label: "Октябрь — Декабрь", from: "-10-01", to: "-12-31" },
};

// Вычисляем даты из записи архива
function parsePeriodDates(period: string): { from: string; to: string } {
  // "2026-01-01 — 2026-03-31" или "Январь — Март 2026"
  const match = period.match(/(\d{4}-\d{2}-\d{2})\s*—\s*(\d{4}-\d{2}-\d{2})/);
  if (match) return { from: match[1], to: match[2] };
  return { from: "", to: "" };
}

// Скачать blob как файл
function downloadBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}

// Скачать файл по URL
function downloadFromUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function fmtNum(n: number) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Сводный финансовый отчёт: итоги + разбивка по статьям
async function downloadSummaryReport(dateFrom: string, dateTo: string, filename: string) {
  const res = await api.transactions.list({ date_from: dateFrom, date_to: dateTo });
  const txs = res.transactions.filter((t) => t.status !== "Отменено");

  const income = txs.filter((t) => Number(t.amount) > 0);
  const expense = txs.filter((t) => Number(t.amount) < 0);

  const totalIncome = income.reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = expense.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const profit = totalIncome - totalExpense;

  // Группировка расходов по статьям
  const byCategory: Record<string, number> = {};
  expense.forEach((t) => {
    const cat = t.category || "Прочее";
    byCategory[cat] = (byCategory[cat] || 0) + Math.abs(Number(t.amount));
  });
  const catRows = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, sum]) => [cat, fmtNum(sum), fmtNum((sum / totalExpense) * 100) + "%"]);

  const sep = ["", "", "", "", "", ""];
  const rows: string[][] = [
    ["ФИНАНСОВЫЙ ОТЧЁТ", "", "", "", "", ""],
    [`Период: ${dateFrom} — ${dateTo}`, "", "", "", "", ""],
    sep,
    ["ИТОГИ", "", "", "", "", ""],
    ["Доходы", fmtNum(totalIncome), "", "", "", ""],
    ["Расходы", fmtNum(totalExpense), "", "", "", ""],
    ["Чистая прибыль", fmtNum(profit), "", "", "", ""],
    sep,
    ["РАСХОДЫ ПО СТАТЬЯМ ЗАТРАТ", "", "", "", "", ""],
    ["Статья", "Сумма (руб)", "Доля", "", "", ""],
    ...catRows,
    sep,
    ["ОПЕРАЦИИ", "", "", "", "", ""],
    ["Дата", "Тип", "Категория", "Описание", "Сумма (руб)", "Статус"],
    ...txs.map((t) => [
      String(t.date || "").slice(0, 10),
      Number(t.amount) >= 0 ? "Доход" : "Расход",
      t.category || "",
      (t.description || "").replace(/"/g, '""'),
      fmtNum(Math.abs(Number(t.amount))),
      t.status || "",
    ]),
  ];

  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

interface ReportWithDates extends TaxReport {
  date_from?: string;
  date_to?: string;
}

const VAT_OPTIONS = [
  { value: "0", label: "Без НДС" },
  { value: "20", label: "НДС 20%" },
  { value: "22", label: "НДС 22%" },
  { value: "10", label: "НДС 10%" },
];

export default function TaxReports() {
  const [reports, setReports] = useState<ReportWithDates[]>([]);
  const [summary, setSummary] = useState({ income: 0, expense: 0, tax_base: 0, vat: 0 });
  const [loading, setLoading] = useState(true);
  const [periodType, setPeriodType] = useState<"quarter" | "year" | "custom">("quarter");
  const [quarter, setQuarter] = useState("Q2");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ name: string; dateFrom: string; dateTo: string } | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [vatRate, setVatRate] = useState("20");

  useEffect(() => {
    Promise.all([api.taxReports.list(), api.taxReports.summary()])
      .then(([reportsRes, summaryRes]) => {
        setReports(reportsRes.reports);
        setSummary(summaryRes);
      })
      .finally(() => setLoading(false));
  }, []);

  const getPeriodDates = () => {
    if (periodType === "quarter") {
      const range = MONTH_RANGES[quarter];
      return { dateFrom: year + range.from, dateTo: year + range.to, label: `${range.label} ${year}`, name: `Налоговый отчёт ${quarter} ${year}` };
    } else if (periodType === "year") {
      return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, label: `Январь — Декабрь ${year}`, name: `Годовой отчёт ${year}` };
    } else {
      return { dateFrom: customFrom, dateTo: customTo, label: `${customFrom} — ${customTo}`, name: `Отчёт ${customFrom} — ${customTo}` };
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerated(null);
    const { dateFrom, dateTo, label, name } = getPeriodDates();

    const periodSummary = await api.taxReports.summary({ date_from: dateFrom, date_to: dateTo });
    setSummary(periodSummary);

    const res = await api.taxReports.create({
      name,
      period: `${dateFrom} — ${dateTo}`,
      report_type: periodType === "year" ? "Годовой" : periodType === "quarter" ? "Квартальный" : "Произвольный",
      status: "Готов",
      size_label: "CSV",
    });
    setReports((prev) => [{ ...res.report, date_from: dateFrom, date_to: dateTo }, ...prev]);
    setGenerating(false);
    setGenerated({ name, dateFrom, dateTo });
    setTimeout(() => setGenerated(null), 8000);
  };

  const handleDownload = async (report: ReportWithDates) => {
    setDownloading(report.id);
    const dates = parsePeriodDates(report.period);
    const df = report.date_from || dates.from;
    const dt = report.date_to || dates.to;
    try {
      await downloadSummaryReport(df, dt, `отчёт_${df}_${dt}.csv`);
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadDirect = async (dateFrom: string, dateTo: string, name: string) => {
    const safeName = name.replace(/\s+/g, "_");
    await downloadSummaryReport(dateFrom, dateTo, `${safeName}.csv`);
  };

  const [pdfLoading, setPdfLoading] = useState<string | null>(null);

  const handleDownloadPdf = async (dateFrom: string, dateTo: string, name: string, mode: "report" | "docs" = "report") => {
    const key = mode + dateFrom + dateTo;
    setPdfLoading(key);
    try {
      if (mode === "docs") {
        const res = await api.docsPdf();
        if (!res.ok || !res.url) {
          alert(res.error || "Нет документов для генерации PDF");
          return;
        }
        downloadFromUrl(res.url, res.filename || "documents.pdf");
      } else {
        const res = await api.generatePdf({ date_from: dateFrom, date_to: dateTo, taxable_only: true, vat_rate: vatRate, mode });
        downloadFromUrl(res.url, res.filename);
      }
    } catch (e) {
      alert("Ошибка генерации PDF. Попробуйте ещё раз.");
      console.error(e);
    } finally {
      setPdfLoading(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить отчёт из архива?")) return;
    await api.taxReports.delete(id);
    setReports((prev) => prev.filter((r) => r.id !== id));
  };

  const vatMultiplier = Number(vatRate) / 100;
  const vatAmount = summary.tax_base * vatMultiplier;

  const summaryItems = [
    { label: "Доходы за период", value: fmt(summary.income), icon: "TrendingUp", color: "text-positive" },
    { label: "Расходы за период", value: fmt(summary.expense), icon: "TrendingDown", color: "text-negative" },
    { label: "Налогооблагаемая база", value: fmt(summary.tax_base), icon: "Calculator", color: "text-gold" },
    {
      label: `НДС ${vatRate === "0" ? "— Без НДС" : vatRate + "% (оценка)"}`,
      value: vatRate === "0" ? "—" : fmt(vatAmount),
      icon: "Receipt",
      color: "text-foreground",
      isVat: true,
    },
  ];

  const fDate = (d: string) => { try { return new Date(d).toLocaleDateString("ru-RU"); } catch { return d; } };

  // Quick export current period
  const { dateFrom: curFrom, dateTo: curTo } = getPeriodDates();

  return (
    <div className="animate-fade-in space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-4">
        {summaryItems.map((item, i) => (
          <div key={i} className="card-fin p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon name={item.icon} size={14} className={item.color} />
              <span className="text-[11px] sm:text-xs text-muted-foreground leading-tight flex-1 line-clamp-2">{item.label}</span>
            </div>
            {loading
              ? <div className="h-6 bg-secondary/60 rounded animate-pulse w-2/3" />
              : <div className={`font-mono-fin text-sm sm:text-lg font-semibold break-all ${item.color}`}>{item.value}</div>}
            {"isVat" in item && item.isVat && (
              <div className="mt-2">
                <select value={vatRate} onChange={(e) => setVatRate(e.target.value)}
                  className="w-full text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                  {VAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Generate form */}
        <div className="lg:col-span-2 card-fin p-3 sm:p-5">
          <div className="text-[11px] sm:text-xs uppercase tracking-wider sm:tracking-widest text-muted-foreground mb-3 sm:mb-4 gold-line pl-3">Сформировать отчёт</div>

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
            className="w-full py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mb-3">
            {generating
              ? <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />Считается...</>
              : <><Icon name="BarChart2" size={15} />Сформировать и сохранить</>}
          </button>

          {/* Quick download: PDF + CSV */}
          <button
            onClick={() => handleDownloadPdf(curFrom, curTo, getPeriodDates().name, "report")}
            disabled={!!pdfLoading}
            className="w-full py-2.5 border border-gold/40 text-gold rounded text-sm font-medium hover:bg-gold/10 transition-colors flex items-center justify-center gap-2 mb-2 disabled:opacity-60">
            {pdfLoading === ("report" + curFrom + curTo)
              ? <><div className="w-4 h-4 rounded-full border-2 border-gold border-t-transparent animate-spin" />Формируется...</>
              : <><Icon name="FileDown" size={15} /> Скачать PDF для налоговой</>}
          </button>
          <button
            onClick={() => handleDownloadPdf(curFrom, curTo, getPeriodDates().name, "docs")}
            disabled={!!pdfLoading}
            className="w-full py-2.5 border border-border text-muted-foreground rounded text-sm font-medium hover:text-foreground hover:border-gold/40 transition-colors flex items-center justify-center gap-2 mb-2 disabled:opacity-60">
            {pdfLoading === ("docs" + curFrom + curTo)
              ? <><div className="w-4 h-4 rounded-full border-2 border-border border-t-transparent animate-spin" />Формируется...</>
              : <><Icon name="Images" size={15} /> Скачать документы PDF</>}
          </button>
          <button onClick={() => handleDownloadDirect(curFrom, curTo, `отчёт_${curFrom}_${curTo}`)}
            className="w-full py-2 border border-border rounded text-xs text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors flex items-center justify-center gap-1.5">
            <Icon name="Download" size={13} /> Сводный отчёт CSV
          </button>

          {generated && (
            <div className="mt-3 p-3 rounded-lg bg-green-900/20 border border-green-900/30 text-positive text-xs animate-fade-in space-y-2">
              <div className="flex items-center gap-2"><Icon name="CheckCircle" size={14} /> Отчёт сохранён в архив</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => handleDownloadPdf(generated.dateFrom, generated.dateTo, generated.name)}
                  className="py-1.5 bg-gold/20 text-gold border border-gold/30 rounded text-xs flex items-center justify-center gap-1 font-medium">
                  <Icon name="FileDown" size={12} /> PDF
                </button>
                <button onClick={() => handleDownloadDirect(generated.dateFrom, generated.dateTo, generated.name)}
                  className="py-1.5 bg-positive/20 text-positive border border-positive/30 rounded text-xs flex items-center justify-center gap-1">
                  <Icon name="Download" size={12} /> Сводный CSV
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Archive */}
        <div className="lg:col-span-3 card-fin overflow-hidden">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border flex items-center justify-between">
            <span className="text-[11px] sm:text-xs uppercase tracking-wider sm:tracking-widest text-muted-foreground">Архив отчётов</span>
            <span className="text-xs text-muted-foreground font-mono-fin">{reports.length} шт.</span>
          </div>
          {loading ? (
            <div className="divide-y divide-border/50">
              {Array(3).fill(0).map((_, i) => (
                <div key={i} className="px-5 py-4 flex gap-4 animate-pulse">
                  <div className="w-9 h-9 rounded-lg bg-secondary flex-shrink-0" />
                  <div className="flex-1 space-y-2"><div className="h-4 bg-secondary rounded w-2/3" /><div className="h-3 bg-secondary rounded w-1/2" /></div>
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
              {reports.map((r) => {
                const dates = parsePeriodDates(r.period);
                const df = r.date_from || dates.from;
                const dt = r.date_to || dates.to;
                return (
                  <div key={r.id} className="px-3 sm:px-5 py-3 sm:py-4 hover-row">
                    <div className="flex items-start gap-2.5 sm:gap-3">
                      <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <Icon name="FileText" size={16} className="text-gold" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{r.name}</div>
                            <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">{r.period} • {fDate(r.created_at)}</div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] sm:text-xs text-positive bg-green-900/20 px-2 py-0.5 rounded-full whitespace-nowrap">{r.status}</span>
                            <button onClick={() => handleDelete(r.id)}
                              className="w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-negative hover:bg-red-900/20 transition-colors">
                              <Icon name="Trash2" size={14} />
                            </button>
                          </div>
                        </div>
                        {/* Download buttons */}
                        <div className="flex gap-1.5 mt-2.5 flex-wrap">
                          <button
                            onClick={() => handleDownloadPdf(df, dt, r.name, "report")}
                            disabled={!!pdfLoading}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gold/40 text-gold hover:bg-gold/10 transition-colors font-medium disabled:opacity-60">
                            {pdfLoading === ("report" + df + dt)
                              ? <div className="w-3 h-3 rounded-full border-2 border-gold border-t-transparent animate-spin" />
                              : <Icon name="FileDown" size={12} />} PDF
                          </button>
                          <button
                            onClick={() => handleDownload(r)}
                            disabled={downloading === r.id}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors disabled:opacity-50">
                            {downloading === r.id
                              ? <div className="w-3 h-3 rounded-full border border-muted-foreground border-t-transparent animate-spin" />
                              : <Icon name="Download" size={12} />}
                            Операции
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}