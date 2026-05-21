import { useState } from "react";
import Icon from "@/components/ui/icon";

const allTx = [
  { id: "TX-0421", date: "21.05.2026", desc: "Оплата подрядчику ООО «СтройГрупп»", category: "Услуги", amount: -480000, status: "Выполнено" },
  { id: "TX-0420", date: "21.05.2026", desc: "Поступление от клиента АО «Метрополь»", category: "Выручка", amount: 1250000, status: "Выполнено" },
  { id: "TX-0419", date: "20.05.2026", desc: "Аренда офиса — май 2026", category: "Аренда", amount: -180000, status: "Выполнено" },
  { id: "TX-0418", date: "20.05.2026", desc: "Зарплатная ведомость #5/2026", category: "Зарплаты", amount: -3200000, status: "Выполнено" },
  { id: "TX-0417", date: "19.05.2026", desc: "Закупка оборудования Dell", category: "Оборудование", amount: -890000, status: "В обработке" },
  { id: "TX-0416", date: "19.05.2026", desc: "Поступление ООО «ПартнёрТех»", category: "Выручка", amount: 2100000, status: "Выполнено" },
  { id: "TX-0415", date: "18.05.2026", desc: "Маркетинговое агентство Clever", category: "Маркетинг", amount: -320000, status: "Выполнено" },
  { id: "TX-0414", date: "17.05.2026", desc: "Возврат переплаты от поставщика", category: "Прочее", amount: 45000, status: "Выполнено" },
  { id: "TX-0413", date: "16.05.2026", desc: "Логистика — ТК «Деловые линии»", category: "Логистика", amount: -210000, status: "Выполнено" },
  { id: "TX-0412", date: "15.05.2026", desc: "Поступление ИП Захаров А.В.", category: "Выручка", amount: 780000, status: "Выполнено" },
  { id: "TX-0411", date: "14.05.2026", desc: "Подписка на облачные сервисы", category: "Прочее", amount: -48000, status: "Выполнено" },
  { id: "TX-0410", date: "13.05.2026", desc: "Поступление ГК «Технопром»", category: "Выручка", amount: 3400000, status: "В обработке" },
];

const categories = ["Все", "Выручка", "Зарплаты", "Аренда", "Оборудование", "Маркетинг", "Логистика", "Услуги", "Прочее"];

const fmt = (n: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);

export default function Transactions() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("Все");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = allTx.filter((tx) => {
    const matchSearch = tx.desc.toLowerCase().includes(search.toLowerCase()) || tx.id.toLowerCase().includes(search.toLowerCase());
    const matchCat = cat === "Все" || tx.category === cat;
    return matchSearch && matchCat;
  });

  return (
    <div className="animate-fade-in space-y-4">
      <div className="card-fin p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по описанию или ID..."
            className="w-full bg-secondary border border-border rounded px-3 py-2 pl-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </div>
        <button className="flex items-center gap-2 px-3 py-2 rounded border border-border text-sm text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors">
          <Icon name="Download" size={14} />
          Экспорт
        </button>
      </div>

      <div className="card-fin overflow-hidden">
        <div className="flex gap-1 p-3 border-b border-border overflow-x-auto">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-3 py-1 rounded text-xs whitespace-nowrap transition-colors ${cat === c ? "bg-gold text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">ID</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Дата</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Описание</th>
                <th className="text-left px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Категория</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Сумма</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => (
                <tr key={tx.id} className="border-b border-border/50 hover-row cursor-pointer">
                  <td className="px-4 py-3 font-mono-fin text-xs text-muted-foreground">{tx.id}</td>
                  <td className="px-4 py-3 font-mono-fin text-xs text-muted-foreground">{tx.date}</td>
                  <td className="px-4 py-3 text-sm">{tx.desc}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">{tx.category}</span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono-fin text-sm font-medium ${tx.amount > 0 ? "text-positive" : "text-negative"}`}>
                    {tx.amount > 0 ? "+" : ""}{fmt(tx.amount)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${tx.status === "Выполнено" ? "bg-green-900/30 text-positive" : "bg-yellow-900/30 text-yellow-400"}`}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Операции не найдены
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>Показано {filtered.length} из {allTx.length} операций</span>
          <div className="flex gap-1">
            <button className="px-2 py-1 rounded border border-border hover:border-gold/40 transition-colors">‹</button>
            <button className="px-2 py-1 rounded bg-gold text-primary-foreground">1</button>
            <button className="px-2 py-1 rounded border border-border hover:border-gold/40 transition-colors">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}
