import { useState, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type Transaction } from "@/lib/api";

const CATEGORIES = ["Все", "Выручка", "Зарплаты", "Аренда", "Оборудование", "Маркетинг", "Логистика", "Услуги", "Прочее"];
const STATUSES = ["Выполнено", "В обработке", "Отменено"];

interface FormState {
  date: string;
  description: string;
  category: string;
  amount: string;
  type: "income" | "expense";
  status: string;
}

const emptyForm = (): FormState => ({
  date: new Date().toISOString().split("T")[0],
  description: "",
  category: "Прочее",
  amount: "",
  type: "expense",
  status: "Выполнено",
});

export default function Transactions() {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("Все");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.transactions.list({ search, category: cat, date_from: dateFrom, date_to: dateTo });
      setTxs(res.transactions);
    } finally {
      setLoading(false);
    }
  }, [search, cat, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditTx(null);
    setForm(emptyForm());
    setError("");
    setShowForm(true);
  };

  const openEdit = (tx: Transaction) => {
    setEditTx(tx);
    setForm({
      date: typeof tx.date === "string" ? tx.date.split("T")[0] : tx.date,
      description: tx.description,
      category: tx.category,
      amount: String(Math.abs(tx.amount)),
      type: tx.amount >= 0 ? "income" : "expense",
      status: tx.status,
    });
    setError("");
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.description.trim()) { setError("Введите описание"); return; }
    if (!form.amount || isNaN(Number(form.amount))) { setError("Введите корректную сумму"); return; }
    setSaving(true);
    setError("");
    const amount = Number(form.amount) * (form.type === "expense" ? -1 : 1);
    try {
      if (editTx) {
        await api.transactions.update(editTx.id, {
          date: form.date, description: form.description,
          category: form.category, amount, status: form.status,
        });
      } else {
        await api.transactions.create({
          date: form.date, description: form.description,
          category: form.category, amount, status: form.status,
        });
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить операцию?")) return;
    setDeletingId(id);
    try {
      await api.transactions.delete(id);
      setTxs((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const fDate = (d: string) => {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("ru-RU");
  };

  return (
    <div className="animate-fade-in space-y-3">
      {/* Filters */}
      <div className="card-fin p-3 sm:p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск..."
              className="w-full bg-secondary border border-border rounded px-3 py-2 pl-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
          </div>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-gold text-primary-foreground text-sm font-medium hover:bg-yellow-500 transition-colors whitespace-nowrap">
            <Icon name="Plus" size={15} />
            <span className="hidden sm:inline">Добавить</span>
          </button>
        </div>
        <div className="flex gap-2">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="flex-1 bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="flex-1 bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
        </div>
      </div>

      {/* Category filter */}
      <div className="card-fin overflow-hidden">
        <div className="flex gap-1 p-2.5 border-b border-border overflow-x-auto scrollbar-none">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors ${cat === c ? "bg-gold text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
              {c}
            </button>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Дата", "Описание", "Категория", "Сумма", "Статус", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && Array(5).fill(0).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array(6).fill(0).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-secondary/60 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))}
              {!loading && txs.map((tx) => (
                <tr key={tx.id} onClick={() => openEdit(tx)} className="border-b border-border/50 hover-row cursor-pointer">
                  <td className="px-4 py-3 font-mono-fin text-xs text-muted-foreground whitespace-nowrap">{fDate(tx.date)}</td>
                  <td className="px-4 py-3 text-sm max-w-xs truncate">{tx.description}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">{tx.category}</span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono-fin text-sm font-medium whitespace-nowrap ${tx.amount > 0 ? "text-positive" : "text-negative"}`}>
                    {tx.amount > 0 ? "+" : ""}{fmt(tx.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${tx.status === "Выполнено" ? "bg-green-900/30 text-positive" : tx.status === "Отменено" ? "bg-red-900/30 text-negative" : "bg-yellow-900/30 text-yellow-400"}`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => handleDelete(tx.id)} disabled={deletingId === tx.id}
                      className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-negative hover:bg-red-900/20 transition-colors">
                      {deletingId === tx.id ? <div className="w-3 h-3 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" /> : <Icon name="Trash2" size={13} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && txs.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <Icon name="Inbox" size={28} className="mx-auto mb-2 opacity-40" />
              Операций нет. Нажмите «Добавить» для создания первой.
            </div>
          )}
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-border/50">
          {loading && Array(4).fill(0).map((_, i) => (
            <div key={i} className="px-4 py-3 space-y-1.5 animate-pulse">
              <div className="h-4 bg-secondary/60 rounded w-3/4" />
              <div className="h-3 bg-secondary/40 rounded w-1/2" />
            </div>
          ))}
          {!loading && txs.map((tx) => (
            <div key={tx.id} onClick={() => openEdit(tx)} className="px-4 py-3 hover-row cursor-pointer">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-sm leading-snug flex-1">{tx.description}</div>
                <div className={`font-mono-fin text-sm font-semibold whitespace-nowrap ${tx.amount > 0 ? "text-positive" : "text-negative"}`}>
                  {tx.amount > 0 ? "+" : ""}{fmt(tx.amount)}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono-fin">{fDate(tx.date)}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{tx.category}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${tx.status === "Выполнено" ? "bg-green-900/30 text-positive" : "bg-yellow-900/30 text-yellow-400"}`}>{tx.status}</span>
              </div>
            </div>
          ))}
          {!loading && txs.length === 0 && (
            <div className="py-10 text-center text-muted-foreground text-sm">Операций нет</div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
          Показано {txs.length} операций
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowForm(false)}>
          <div className="w-full sm:max-w-lg card-fin rounded-t-2xl sm:rounded-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{editTx ? "Редактировать операцию" : "Новая операция"}</h2>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><Icon name="X" size={18} /></button>
            </div>

            {/* Income / Expense toggle */}
            <div className="flex gap-1 p-1 bg-secondary rounded-lg">
              <button onClick={() => setForm((f) => ({ ...f, type: "income" }))}
                className={`flex-1 py-2 text-sm rounded transition-all ${form.type === "income" ? "bg-positive/20 text-positive font-medium" : "text-muted-foreground"}`}>
                + Доход
              </button>
              <button onClick={() => setForm((f) => ({ ...f, type: "expense" }))}
                className={`flex-1 py-2 text-sm rounded transition-all ${form.type === "expense" ? "bg-red-900/20 text-negative font-medium" : "text-muted-foreground"}`}>
                − Расход
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Описание *</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Например: Оплата аренды офиса"
                  className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Сумма (₽) *</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0"
                    className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Дата</label>
                  <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Категория</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                    {CATEGORIES.filter((c) => c !== "Все").map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Статус</label>
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {error && <div className="text-xs text-negative bg-red-900/20 border border-red-900/30 rounded px-3 py-2">{error}</div>}

            <div className="flex gap-2 pt-1">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" /> : <Icon name="Check" size={15} />}
                {editTx ? "Сохранить" : "Создать"}
              </button>
              {editTx && (
                <button onClick={() => handleDelete(editTx.id)} disabled={deletingId === editTx.id}
                  className="px-4 py-2.5 border border-red-900/40 text-negative rounded text-sm hover:bg-red-900/20 transition-colors">
                  <Icon name="Trash2" size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
