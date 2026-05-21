import { useState, useRef } from "react";
import Icon from "@/components/ui/icon";

interface DocFile {
  id: string;
  name: string;
  size: string;
  status: "processing" | "done" | "error";
  recognized?: {
    type: string;
    amount?: string;
    date?: string;
    counterparty?: string;
    inn?: string;
  };
}

const mockDocs: DocFile[] = [
  {
    id: "1", name: "invoice_april_2026.pdf", size: "1.2 МБ", status: "done",
    recognized: { type: "Счёт-фактура", amount: "₽ 248 000", date: "15.04.2026", counterparty: "ООО «СтройГрупп»", inn: "7712345678" }
  },
  {
    id: "2", name: "contract_metropol.pdf", size: "3.7 МБ", status: "done",
    recognized: { type: "Договор", date: "01.03.2026", counterparty: "АО «Метрополь»", inn: "7701234567" }
  },
  {
    id: "3", name: "act_april.jpg", size: "0.8 МБ", status: "processing",
    recognized: undefined
  },
];

export default function Documents() {
  const [docs, setDocs] = useState<DocFile[]>(mockDocs);
  const [selected, setSelected] = useState<DocFile | null>(mockDocs[0]);
  const [dragging, setDragging] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const addFiles = (files: File[]) => {
    const newDocs: DocFile[] = files.map((f) => ({
      id: Date.now().toString() + f.name,
      name: f.name,
      size: `${(f.size / 1024 / 1024).toFixed(1)} МБ`,
      status: "processing",
    }));
    setDocs((prev) => [...newDocs, ...prev]);
    setSelected(newDocs[0]);
    setMobileView("detail");
    newDocs.forEach((d) => {
      setTimeout(() => {
        setDocs((prev) =>
          prev.map((doc) =>
            doc.id === d.id
              ? {
                  ...doc, status: "done",
                  recognized: {
                    type: "Документ",
                    amount: "—",
                    date: new Date().toLocaleDateString("ru-RU"),
                    counterparty: "Определяется ИИ",
                    inn: "—",
                  },
                }
              : doc
          )
        );
        setSelected((prev) =>
          prev?.id === d.id
            ? {
                ...prev, status: "done",
                recognized: {
                  type: "Документ",
                  amount: "—",
                  date: new Date().toLocaleDateString("ru-RU"),
                  counterparty: "Определяется ИИ",
                  inn: "—",
                },
              }
            : prev
        );
      }, 3000);
    });
  };

  const handleSelect = (doc: DocFile) => {
    setSelected(doc);
    setMobileView("detail");
  };

  return (
    <div className="animate-fade-in flex flex-col gap-4">

      {/* Mobile: camera + upload big buttons */}
      <div className="grid grid-cols-2 gap-3 lg:hidden">
        <button
          onClick={() => cameraRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-5 card-fin border-2 border-dashed border-gold/40 rounded-xl text-gold active:scale-95 transition-transform"
        >
          <Icon name="Camera" size={28} />
          <span className="text-sm font-medium">Сфотографировать</span>
          <span className="text-xs text-muted-foreground">Чек, счёт, договор</span>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))}
          />
        </button>
        <button
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-5 card-fin border-dashed border-border/60 rounded-xl text-muted-foreground active:scale-95 transition-transform"
        >
          <Icon name="Upload" size={28} />
          <span className="text-sm font-medium">Загрузить файл</span>
          <span className="text-xs">PDF, JPG, PNG</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))}
          />
        </button>
      </div>

      {/* Mobile tabs */}
      <div className="flex lg:hidden gap-1 card-fin p-1 rounded-xl">
        <button
          onClick={() => setMobileView("list")}
          className={`flex-1 py-2 text-sm rounded-lg transition-all ${mobileView === "list" ? "bg-gold text-primary-foreground font-medium" : "text-muted-foreground"}`}
        >
          Все документы ({docs.length})
        </button>
        <button
          onClick={() => setMobileView("detail")}
          className={`flex-1 py-2 text-sm rounded-lg transition-all ${mobileView === "detail" ? "bg-gold text-primary-foreground font-medium" : "text-muted-foreground"}`}
        >
          Результат ИИ
        </button>
      </div>

      {/* Desktop: side-by-side layout | Mobile: tab-based */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Document list */}
        <div className={`lg:col-span-2 card-fin flex flex-col ${mobileView === "detail" ? "hidden lg:flex" : "flex"}`}>
          {/* Desktop upload zone */}
          <div className="p-4 border-b border-border hidden lg:block">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Загрузка</div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${dragging ? "border-gold bg-gold/5" : "border-border hover:border-gold/40 hover:bg-secondary/50"}`}
            >
              <Icon name="Upload" size={24} className={`mx-auto mb-2 ${dragging ? "text-gold" : "text-muted-foreground"}`} />
              <div className="text-sm font-medium mb-1">Перетащите или нажмите</div>
              <div className="text-xs text-muted-foreground">PDF, JPG, PNG</div>
              <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {docs.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">Загрузите первый документ</div>
            )}
            {docs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => handleSelect(doc)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all mb-1 ${
                  selected?.id === doc.id ? "bg-gold/10 border border-gold/30" : "hover:bg-secondary border border-transparent"
                }`}
              >
                <div className="w-9 h-9 rounded flex items-center justify-center bg-secondary flex-shrink-0">
                  <Icon name={doc.name.match(/\.(jpg|jpeg|png)$/i) ? "Image" : "FileText"} size={17} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{doc.name}</div>
                  <div className="text-xs text-muted-foreground">{doc.size}</div>
                </div>
                <div className="flex-shrink-0">
                  {doc.status === "done" && <Icon name="CheckCircle" size={14} className="text-positive" />}
                  {doc.status === "processing" && <div className="w-3 h-3 rounded-full border-2 border-gold border-t-transparent animate-spin" />}
                  {doc.status === "error" && <Icon name="AlertCircle" size={14} className="text-negative" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail / AI result */}
        <div className={`lg:col-span-3 card-fin p-4 sm:p-5 flex flex-col min-h-64 ${mobileView === "list" ? "hidden lg:flex" : "flex"}`}>
          {selected ? (
            <>
              <div className="flex items-start justify-between mb-4 gap-2">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">ИИ-распознавание</div>
                  <div className="text-sm font-medium truncate">{selected.name}</div>
                </div>
                <div className="flex-shrink-0">
                  {selected.status === "done" && (
                    <span className="flex items-center gap-1.5 text-xs text-positive bg-green-900/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                      <Icon name="Sparkles" size={12} /> Распознано
                    </span>
                  )}
                  {selected.status === "processing" && (
                    <span className="flex items-center gap-1.5 text-xs text-yellow-400 bg-yellow-900/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                      <div className="w-2.5 h-2.5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                      Обрабатывается
                    </span>
                  )}
                </div>
              </div>

              {selected.status === "done" && selected.recognized ? (
                <div className="space-y-2.5">
                  {[
                    { label: "Тип документа", value: selected.recognized.type, icon: "FileType" },
                    { label: "Контрагент", value: selected.recognized.counterparty, icon: "Building2" },
                    { label: "ИНН", value: selected.recognized.inn, icon: "Hash" },
                    { label: "Дата", value: selected.recognized.date, icon: "Calendar" },
                    { label: "Сумма", value: selected.recognized.amount, icon: "DollarSign" },
                  ]
                    .filter((f) => f.value)
                    .map((field) => (
                      <div key={field.label} className="card-fin-raised p-3 flex items-center gap-3">
                        <div className="w-8 h-8 rounded flex items-center justify-center bg-gold/10 flex-shrink-0">
                          <Icon name={field.icon} size={14} className="text-gold" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted-foreground">{field.label}</div>
                          <div className="text-sm font-medium mt-0.5 truncate">{field.value}</div>
                        </div>
                        <button className="text-muted-foreground hover:text-foreground transition-colors p-1">
                          <Icon name="Pencil" size={13} />
                        </button>
                      </div>
                    ))}
                  <div className="flex gap-2 pt-2">
                    <button className="flex-1 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors active:scale-95">
                      Создать операцию
                    </button>
                    <button className="px-4 py-2.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors">
                      Отклонить
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 py-8">
                  <div className="w-12 h-12 rounded-full border-4 border-border border-t-gold animate-spin" />
                  <div className="text-sm">ИИ анализирует документ...</div>
                  <div className="text-xs">Обычно занимает 5–15 секунд</div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 py-8">
              <Icon name="FileSearch" size={32} />
              <div className="text-sm">Выберите документ для просмотра</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
