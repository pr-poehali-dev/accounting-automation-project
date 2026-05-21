import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api, type DocRecord } from "@/lib/api";

export default function Documents() {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DocRecord | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const loadDocs = async () => {
    try {
      const res = await api.documents.list();
      setDocs(res.documents);
      if (res.documents.length > 0 && !selected) setSelected(res.documents[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDocs(); }, []);

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      const sizeLabel = `${(f.size / 1024 / 1024).toFixed(1)} МБ`;
      // Create DB record with processing status
      const res = await api.documents.create({
        name: f.name,
        size_label: sizeLabel,
        status: "processing",
      });
      const newDoc = res.document as DocRecord;
      setDocs((prev) => [newDoc, ...prev]);
      setSelected(newDoc);
      setMobileView("detail");

      // Simulate AI recognition after 3s (will be real AI later)
      setTimeout(async () => {
        const updated = await api.documents.update(newDoc.id, {
          status: "done",
          rec_type: f.name.toLowerCase().includes("счет") || f.name.toLowerCase().includes("invoice") ? "Счёт-фактура"
            : f.name.toLowerCase().includes("договор") || f.name.toLowerCase().includes("contract") ? "Договор"
            : "Документ",
          rec_date: new Date().toLocaleDateString("ru-RU"),
          rec_counterparty: "Определяется...",
          rec_inn: "—",
          rec_amount: "—",
        });
        setDocs((prev) => prev.map((d) => d.id === newDoc.id ? updated.document : d));
        setSelected((prev) => prev?.id === newDoc.id ? updated.document : prev);
      }, 3000);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const handleSelect = (doc: DocRecord) => {
    setSelected(doc);
    setMobileView("detail");
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить документ?")) return;
    await api.documents.delete(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleFieldUpdate = async (field: string, value: string) => {
    if (!selected) return;
    const updated = await api.documents.update(selected.id, { [field]: value });
    setDocs((prev) => prev.map((d) => d.id === selected.id ? updated.document : d));
    setSelected(updated.document);
  };

  return (
    <div className="animate-fade-in flex flex-col gap-4">
      {/* Mobile: camera + upload buttons */}
      <div className="grid grid-cols-2 gap-3 lg:hidden">
        <button onClick={() => cameraRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-5 card-fin border-2 border-dashed border-gold/40 rounded-xl text-gold active:scale-95 transition-transform">
          <Icon name="Camera" size={28} />
          <span className="text-sm font-medium">Сфотографировать</span>
          <span className="text-xs text-muted-foreground">Чек, счёт, договор</span>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
        </button>
        <button onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-5 card-fin border-dashed border-border/60 rounded-xl text-muted-foreground active:scale-95 transition-transform">
          <Icon name="Upload" size={28} />
          <span className="text-sm font-medium">Загрузить файл</span>
          <span className="text-xs">PDF, JPG, PNG</span>
          <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
        </button>
      </div>

      {/* Mobile tabs */}
      <div className="flex lg:hidden gap-1 card-fin p-1 rounded-xl">
        <button onClick={() => setMobileView("list")}
          className={`flex-1 py-2 text-sm rounded-lg transition-all ${mobileView === "list" ? "bg-gold text-primary-foreground font-medium" : "text-muted-foreground"}`}>
          Документы ({docs.length})
        </button>
        <button onClick={() => setMobileView("detail")}
          className={`flex-1 py-2 text-sm rounded-lg transition-all ${mobileView === "detail" ? "bg-gold text-primary-foreground font-medium" : "text-muted-foreground"}`}>
          Результат ИИ
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Document list */}
        <div className={`lg:col-span-2 card-fin flex flex-col ${mobileView === "detail" ? "hidden lg:flex" : "flex"}`}>
          {/* Desktop upload zone */}
          <div className="p-4 border-b border-border hidden lg:block">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${dragging ? "border-gold bg-gold/5" : "border-border hover:border-gold/40 hover:bg-secondary/50"}`}>
              <Icon name="Upload" size={24} className={`mx-auto mb-2 ${dragging ? "text-gold" : "text-muted-foreground"}`} />
              <div className="text-sm font-medium mb-1">Перетащите или нажмите</div>
              <div className="text-xs text-muted-foreground">PDF, JPG, PNG</div>
              <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loading && Array(3).fill(0).map((_, i) => (
              <div key={i} className="p-3 flex gap-3 animate-pulse mb-1">
                <div className="w-9 h-9 bg-secondary rounded flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 bg-secondary rounded w-3/4" />
                  <div className="h-3 bg-secondary rounded w-1/2" />
                </div>
              </div>
            ))}
            {!loading && docs.length === 0 && (
              <div className="py-8 text-center text-muted-foreground text-sm">Загрузите первый документ</div>
            )}
            {docs.map((doc) => (
              <div key={doc.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all mb-1 ${selected?.id === doc.id ? "bg-gold/10 border border-gold/30" : "hover:bg-secondary border border-transparent"}`}>
                <button onClick={() => handleSelect(doc)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                  <div className="w-9 h-9 rounded flex items-center justify-center bg-secondary flex-shrink-0">
                    <Icon name={doc.name.match(/\.(jpg|jpeg|png)$/i) ? "Image" : "FileText"} size={17} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm truncate">{doc.name}</div>
                    <div className="text-xs text-muted-foreground">{doc.size_label}</div>
                  </div>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {doc.status === "done" && <Icon name="CheckCircle" size={14} className="text-positive" />}
                  {doc.status === "processing" && <div className="w-3 h-3 rounded-full border-2 border-gold border-t-transparent animate-spin" />}
                  {doc.status === "error" && <Icon name="AlertCircle" size={14} className="text-negative" />}
                  <button onClick={() => handleDelete(doc.id)} className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-negative transition-colors ml-1">
                    <Icon name="Trash2" size={12} />
                  </button>
                </div>
              </div>
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

              {selected.status === "done" ? (
                <div className="space-y-2.5">
                  {[
                    { label: "Тип документа", value: selected.rec_type, field: "rec_type", icon: "FileType" },
                    { label: "Контрагент", value: selected.rec_counterparty, field: "rec_counterparty", icon: "Building2" },
                    { label: "ИНН", value: selected.rec_inn, field: "rec_inn", icon: "Hash" },
                    { label: "Дата", value: selected.rec_date, field: "rec_date", icon: "Calendar" },
                    { label: "Сумма", value: selected.rec_amount, field: "rec_amount", icon: "DollarSign" },
                  ].filter((f) => f.value).map((field) => (
                    <EditableField key={field.label} label={field.label} value={field.value!}
                      icon={field.icon} onSave={(v) => handleFieldUpdate(field.field, v)} />
                  ))}
                  <div className="flex gap-2 pt-2">
                    <button className="flex-1 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors active:scale-95">
                      Создать операцию
                    </button>
                    <button onClick={() => selected && handleDelete(selected.id)}
                      className="px-4 py-2.5 border border-red-900/40 text-negative rounded text-sm hover:bg-red-900/20 transition-colors">
                      <Icon name="Trash2" size={15} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 py-8">
                  <div className="w-12 h-12 rounded-full border-4 border-border border-t-gold animate-spin" />
                  <div className="text-sm">ИИ анализирует документ...</div>
                  <div className="text-xs">Обычно 5–15 секунд</div>
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

function EditableField({ label, value, icon, onSave }: { label: string; value: string; icon: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  useEffect(() => setVal(value), [value]);

  const save = () => { setEditing(false); if (val !== value) onSave(val); };

  return (
    <div className="card-fin-raised p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gold/10 flex-shrink-0">
        <Icon name={icon} size={14} className="text-gold" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        {editing ? (
          <input value={val} onChange={(e) => setVal(e.target.value)} onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
            className="w-full text-sm mt-0.5 bg-transparent border-b border-gold outline-none text-foreground" />
        ) : (
          <div className="text-sm font-medium mt-0.5 truncate">{val}</div>
        )}
      </div>
      <button onClick={() => setEditing(!editing)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
        <Icon name={editing ? "Check" : "Pencil"} size={13} />
      </button>
    </div>
  );
}
