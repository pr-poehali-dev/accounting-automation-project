import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type DocRecord, type RecognizeResult } from "@/lib/api";

const CATEGORIES = ["Услуги", "Аренда", "Зарплаты", "Оборудование", "Маркетинг", "Логистика", "Прочее"];

function isImage(name: string) {
  return /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name);
}

function isExcel(name: string) {
  return /\.(xlsx|xls)$/i.test(name);
}

function isSupported(name: string) {
  return /\.(pdf|jpg|jpeg|png|webp|gif|bmp|xlsx|xls)$/i.test(name);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Сжимает изображение до maxSize px по длинной стороне, качество quality (0-1). Возвращает base64 без data:...;base64, */
function compressImageToBase64(file: File, maxSize = 1200, quality = 0.82): Promise<{ b64: string; mime: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round((height * maxSize) / width); width = maxSize; }
        else { width = Math.round((width * maxSize) / height); height = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const mime = "image/jpeg";
      const dataUrl = canvas.toDataURL(mime, quality);
      URL.revokeObjectURL(url);
      resolve({ b64: dataUrl.split(",")[1], mime, previewUrl: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось загрузить изображение")); };
    img.src = url;
  });
}

interface DocWithRecognition extends DocRecord {
  recognizing?: boolean;
  recognition?: RecognizeResult;
  recognitionError?: string;
  previewUrl?: string;
}

interface PageItem {
  file: File;
  previewUrl: string;
  b64: string;
  mime: string;
}

export default function Documents() {
  const [docs, setDocs] = useState<DocWithRecognition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DocWithRecognition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [showTxModal, setShowTxModal] = useState(false);
  const [txForm, setTxForm] = useState({ description: "", amount: "", date: "", category: "Прочее" });
  const [txSaving, setTxSaving] = useState(false);
  const [txSaved, setTxSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const multiCameraRef = useRef<HTMLInputElement>(null);

  // Мультистраничный режим
  const [showMultiModal, setShowMultiModal] = useState(false);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [multiProcessing, setMultiProcessing] = useState(false);

  // localStorage helpers для хранения превью между сессиями
  const savePreview = (docId: number, url: string) => {
    // Сохраняем только data: URLs (base64). blob: ссылки не переживают перезагрузку.
    if (!url.startsWith("data:")) return;
    try { localStorage.setItem(`doc_preview_${docId}`, url); } catch (_) { /* ignore */ }
  };
  const loadPreview = (docId: number): string | undefined => {
    try {
      const v = localStorage.getItem(`doc_preview_${docId}`);
      if (!v || !v.startsWith("data:")) return undefined;
      return v;
    } catch (_) { return undefined; }
  };
  const removePreview = (docId: number) => {
    try { localStorage.removeItem(`doc_preview_${docId}`); } catch (_) { /* ignore */ }
  };

  const loadDocs = async () => {
    try {
      const res = await api.documents.list();
      // Восстанавливаем превью из localStorage
      const withPreviews = res.documents.map((d) => ({ ...d, previewUrl: loadPreview(d.id) }));
      setDocs(withPreviews);
      if (withPreviews.length > 0) setSelected(withPreviews[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDocs(); }, []);

  const recognizeFile = async (docId: number, file: File, previewUrl?: string) => {
    setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, recognizing: true, previewUrl } : d));
    setSelected((prev) => prev?.id === docId ? { ...prev, recognizing: true, previewUrl } : prev);
    try {
      let result: RecognizeResult;
      if (isImage(file.name)) {
        // Высокое разрешение и качество — нужно для мелкого текста таблиц/итогов в накладных
        const compressed = await compressImageToBase64(file, 2400, 0.92);
        result = await api.recognizeDoc({
          image_b64: compressed.b64,
          mime_type: compressed.mime,
          file_name: file.name,
          doc_id: docId,
          auto_create_tx: true,
        });
      } else if (isExcel(file.name)) {
        const b64 = await fileToBase64(file);
        result = await api.recognizeDoc({
          excel_b64: b64,
          file_name: file.name,
          doc_id: docId,
          auto_create_tx: true,
        });
      } else {
        result = await api.recognizeDoc({
          file_name: file.name,
          doc_id: docId,
          auto_create_tx: true,
        });
      }

      // Обновляем документ в БД если ИИ не распознал (он мог уже обновить в бэке)
      if (!result.error) {
        await api.documents.update(docId, {
          status: "done",
          rec_type: result.doc_type,
          rec_amount: result.amount_str || (result.amount ? `₽ ${result.amount}` : undefined),
          rec_date: result.date || undefined,
          rec_counterparty: result.counterparty || undefined,
          rec_inn: result.inn || undefined,
        });
      }

      const updated = await api.documents.list();
      const updatedDoc = updated.documents.find((d) => d.id === docId);
      // Сохраняем превью в localStorage — будет доступно после переключения вкладок
      if (previewUrl) savePreview(docId, previewUrl);
      const finalDoc = { ...(updatedDoc || {}), recognizing: false, recognition: result, previewUrl };
      setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, ...finalDoc } : d));
      setSelected((prev) => prev?.id === docId ? { ...prev, ...finalDoc } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка распознавания";
      await api.documents.update(docId, { status: "error" }).catch(() => {});
      setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, status: "error", recognizing: false, recognitionError: msg } : d));
      setSelected((prev) => prev?.id === docId ? { ...prev, status: "error", recognizing: false, recognitionError: msg } : prev);
    }
  };

  const addFiles = async (files: File[]) => {
    const skipped = files.filter((f) => !isSupported(f.name));
    if (skipped.length) {
      alert(
        `Не поддерживается: ${skipped.map((f) => f.name).join(", ")}\n\n` +
        "ИИ распознаёт: PDF, JPG, PNG, XLS, XLSX."
      );
    }
    const accepted = files.filter((f) => isSupported(f.name));
    for (const f of accepted) {
      // Создаём превью сразу для отображения
      let previewUrl: string | undefined;
      if (isImage(f.name)) {
        try {
          const compressed = await compressImageToBase64(f, 1400, 0.85);
          previewUrl = compressed.previewUrl;
        } catch {
          previewUrl = URL.createObjectURL(f);
        }
      }
      const res = await api.documents.create({
        name: f.name,
        size_label: `${(f.size / 1024 / 1024).toFixed(1)} МБ`,
        status: "processing",
      });
      // Сохраняем превью в localStorage чтобы не терять при переключении вкладок
      if (previewUrl) savePreview(res.document.id, previewUrl);
      const newDoc: DocWithRecognition = { ...res.document, status: "processing", recognizing: true, previewUrl };
      setDocs((prev) => [newDoc, ...prev]);
      setSelected(newDoc);
      setMobileView("detail");
      recognizeFile(res.document.id, f, previewUrl);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const handleSelect = (doc: DocWithRecognition) => { setSelected(doc); setMobileView("detail"); };

  const recognizeAgain = async () => {
    if (!selected) return;
    if (!selected.previewUrl || !selected.previewUrl.startsWith("data:")) {
      alert("Изображение этого документа не сохранилось — загрузите файл заново для повторного распознавания.");
      return;
    }
    setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, recognizing: true, status: "processing" } : d));
    setSelected((prev) => prev ? { ...prev, recognizing: true, status: "processing" } : prev);
    try {
      // Перекодируем превью через canvas в свежий JPEG высокого качества
      const b64 = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const max = 2400;
          if (width > max || height > max) {
            if (width > height) { height = Math.round((height * max) / width); width = max; }
            else { width = Math.round((width * max) / height); height = max; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          resolve(dataUrl.split(",")[1]);
        };
        img.onerror = () => reject(new Error("Не удалось прочитать изображение"));
        img.src = selected.previewUrl!;
      });
      if (!b64 || b64.length < 200) throw new Error("Изображение слишком маленькое или повреждено");
      const result = await api.recognizeDoc({
        image_b64: b64,
        mime_type: "image/jpeg",
        file_name: selected.name || "document.jpg",
        doc_id: selected.id,
        auto_create_tx: true,
      });
      if (!result.error) {
        await api.documents.update(selected.id, {
          status: "done",
          rec_type: result.doc_type,
          rec_amount: result.amount_str || (result.amount ? `₽ ${result.amount}` : undefined),
          rec_date: result.date || undefined,
          rec_counterparty: result.counterparty || undefined,
          rec_inn: result.inn || undefined,
        });
      }
      const updated = await api.documents.list();
      const updatedDoc = updated.documents.find((d) => d.id === selected.id);
      const finalDoc = { ...(updatedDoc || {}), recognizing: false, recognition: result, previewUrl: selected.previewUrl };
      setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, ...finalDoc } : d));
      setSelected((prev) => prev ? { ...prev, ...finalDoc } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка распознавания";
      setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, status: "error", recognizing: false, recognitionError: msg } : d));
      setSelected((prev) => prev ? { ...prev, status: "error", recognizing: false, recognitionError: msg } : prev);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить документ?")) return;
    await api.documents.delete(id);
    removePreview(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleFieldUpdate = async (field: string, value: string) => {
    if (!selected) return;
    const updated = await api.documents.update(selected.id, { [field]: value });
    setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, ...updated.document } : d));
    setSelected((prev) => prev ? { ...prev, ...updated.document } : prev);
  };

  const openCreateTx = () => {
    if (!selected) return;
    const rec = selected.recognition;
    const rawAmount = rec?.amount ? String(rec.amount)
      : (selected.rec_amount || "").replace(/[^\d.,]/g, "").replace(",", ".");
    const recDate = rec?.date || selected.rec_date || "";
    let isoDate = new Date().toISOString().split("T")[0];
    if (recDate) {
      const parts = recDate.split(".");
      if (parts.length === 3) isoDate = `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
      else if (recDate.includes("-")) isoDate = recDate.split("T")[0];
    }
    const desc = rec?.description
      || (selected.rec_counterparty ? `${selected.rec_type || "Оплата"} — ${selected.rec_counterparty}` : selected.rec_type || selected.name);
    setTxForm({ description: desc || "", amount: rawAmount, date: isoDate, category: rec?.category || "Прочее" });
    setTxSaved(false);
    setShowTxModal(true);
  };

  const handleCreateTx = async () => {
    if (!txForm.description || !txForm.amount) return;
    setTxSaving(true);
    try {
      await api.transactions.create({
        date: txForm.date,
        description: txForm.description,
        category: txForm.category,
        amount: -Math.abs(Number(txForm.amount)),
        status: "Выполнено",
      });
      setTxSaved(true);
      setTimeout(() => { setShowTxModal(false); setTxSaved(false); }, 1500);
    } finally {
      setTxSaving(false);
    }
  };

  // ── Мультистраничный режим ──────────────────────────────
  const addPageFromFile = async (file: File) => {
    try {
      const compressed = await compressImageToBase64(file, 1400, 0.85);
      setPages((prev) => [...prev, { file, previewUrl: compressed.previewUrl, b64: compressed.b64, mime: compressed.mime }]);
    } catch {
      /* ignore */
    }
  };

  const removePage = (idx: number) => setPages((prev) => prev.filter((_, i) => i !== idx));

  const handleMultiDone = async () => {
    if (pages.length === 0) return;
    setMultiProcessing(true);
    try {
      // Создаём один документ для всего набора страниц
      const firstName = pages[0].file.name;
      const totalSize = pages.reduce((s, p) => s + p.file.size, 0);
      const sizeMb = (totalSize / 1024 / 1024).toFixed(1);
      const docName = pages.length > 1 ? `Накладная (${pages.length} стр.)` : firstName;

      const res = await api.documents.create({
        name: docName,
        size_label: `${sizeMb} МБ`,
        status: "processing",
      });

      const combinedPreview = pages[0].previewUrl; // первая страница как превью
      if (combinedPreview) savePreview(res.document.id, combinedPreview);

      const newDoc: DocWithRecognition = {
        ...res.document,
        status: "processing",
        recognizing: true,
        previewUrl: combinedPreview,
      };
      setDocs((prev) => [newDoc, ...prev]);
      setSelected(newDoc);
      setMobileView("detail");
      setShowMultiModal(false);

      // Отправляем все страницы
      const images = pages.map((p) => ({ b64: p.b64, mime: p.mime }));
      setPages([]);

      await recognizeMultiPage(res.document.id, images, combinedPreview, docName);
    } finally {
      setMultiProcessing(false);
    }
  };

  const recognizeMultiPage = async (
    docId: number,
    images: { b64: string; mime: string }[],
    previewUrl: string | undefined,
    fileName: string,
  ) => {
    setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, recognizing: true, previewUrl } : d));
    setSelected((prev) => prev?.id === docId ? { ...prev, recognizing: true, previewUrl } : prev);
    try {
      const result = await api.recognizeDoc({
        images,
        file_name: fileName,
        doc_id: docId,
        auto_create_tx: true,
      });

      if (!result.error) {
        await api.documents.update(docId, {
          status: "done",
          rec_type: result.doc_type,
          rec_amount: result.amount_str || (result.amount ? `₽ ${result.amount}` : undefined),
          rec_date: result.date || undefined,
          rec_counterparty: result.counterparty || undefined,
          rec_inn: result.inn || undefined,
        });
      }

      const updated = await api.documents.list();
      const updatedDoc = updated.documents.find((d) => d.id === docId);
      if (previewUrl) savePreview(docId, previewUrl);
      const finalDoc = { ...(updatedDoc || {}), recognizing: false, recognition: result, previewUrl };
      setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, ...finalDoc } : d));
      setSelected((prev) => prev?.id === docId ? { ...prev, ...finalDoc } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка распознавания";
      await api.documents.update(docId, { status: "error" }).catch(() => {});
      setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, status: "error", recognizing: false, recognitionError: msg } : d));
      setSelected((prev) => prev?.id === docId ? { ...prev, status: "error", recognizing: false, recognitionError: msg } : prev);
    }
  };
  // ────────────────────────────────────────────────────────

  const selDone = selected?.status === "done" && !selected.recognizing;

  return (
    <div className="animate-fade-in flex flex-col gap-4">
      {/* Mobile buttons */}
      <div className="grid grid-cols-2 gap-3 lg:hidden">
        <button onClick={() => { setPages([]); setShowMultiModal(true); }}
          className="flex flex-col items-center justify-center gap-2 p-4 card-fin border-2 border-dashed border-gold/40 rounded-xl text-gold active:scale-95 transition-transform">
          <Icon name="Camera" size={26} />
          <span className="text-sm font-medium">Сфотографировать</span>
          <span className="text-xs text-muted-foreground text-center">1 или несколько страниц</span>
        </button>
        <button onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-4 card-fin border-2 border-dashed border-border/60 rounded-xl text-muted-foreground active:scale-95 transition-transform">
          <Icon name="Upload" size={26} />
          <span className="text-sm font-medium">Загрузить файл</span>
          <span className="text-xs">PDF, JPG, PNG, XLS</span>
          <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx" className="hidden"
            onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
        </button>
      </div>
      {/* hidden camera input for multi-page */}
      <input ref={multiCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) { addPageFromFile(e.target.files[0]); e.target.value = ""; } }} />

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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* List */}
        <div className={`lg:col-span-2 card-fin flex flex-col ${mobileView === "detail" ? "hidden lg:flex" : "flex"}`}>
          <div className="p-4 border-b border-border hidden lg:block">
            <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={handleDrop} onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${dragging ? "border-gold bg-gold/5" : "border-border hover:border-gold/40 hover:bg-secondary/50"}`}>
              <Icon name="Upload" size={24} className={`mx-auto mb-2 ${dragging ? "text-gold" : "text-muted-foreground"}`} />
              <div className="text-sm font-medium mb-1">Перетащите или нажмите</div>
              <div className="text-xs text-muted-foreground">PDF, JPG, PNG, XLS — ИИ распознает автоматически</div>
              <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx" className="hidden"
                onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading && Array(3).fill(0).map((_, i) => (
              <div key={i} className="p-3 flex gap-3 animate-pulse mb-1">
                <div className="w-9 h-9 bg-secondary rounded flex-shrink-0" />
                <div className="flex-1 space-y-1.5"><div className="h-4 bg-secondary rounded w-3/4" /><div className="h-3 bg-secondary rounded w-1/2" /></div>
              </div>
            ))}
            {!loading && docs.length === 0 && (
              <div className="py-10 text-center text-muted-foreground text-sm">
                <Icon name="ScanLine" size={28} className="mx-auto mb-2 opacity-40" />
                Загрузите документ — ИИ всё заполнит
              </div>
            )}
            {docs.map((doc) => (
              <div key={doc.id} className={`flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-lg cursor-pointer transition-all mb-1 ${selected?.id === doc.id ? "bg-gold/10 border border-gold/30" : "hover:bg-secondary border border-transparent"}`}>
                <button onClick={() => handleSelect(doc)} className="flex-1 flex items-center gap-2.5 sm:gap-3 text-left min-w-0">
                  <div className="w-9 h-9 rounded flex items-center justify-center bg-secondary flex-shrink-0">
                    <Icon name={isImage(doc.name) ? "Image" : "FileText"} size={17} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{doc.name}</div>
                    <div className="text-[11px] sm:text-xs text-muted-foreground">{doc.size_label}</div>
                  </div>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {doc.recognizing && <div className="w-3.5 h-3.5 rounded-full border-2 border-gold border-t-transparent animate-spin" />}
                  {!doc.recognizing && doc.status === "done" && <Icon name="CheckCircle" size={15} className="text-positive" />}
                  {!doc.recognizing && doc.status === "error" && <Icon name="AlertCircle" size={15} className="text-negative" />}
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }} className="w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-negative hover:bg-red-900/10 transition-colors">
                    <Icon name="Trash2" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className={`lg:col-span-3 card-fin p-3 sm:p-5 flex flex-col min-h-64 ${mobileView === "list" ? "hidden lg:flex" : "flex"}`}>
          {selected ? (
            <>
              <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground mb-1">ИИ-распознавание</div>
                  <div className="text-sm font-medium truncate">{selected.name}</div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {selected.recognizing && (
                    <span className="flex items-center gap-1.5 text-xs text-gold bg-gold/10 px-2.5 py-1 rounded-full whitespace-nowrap">
                      <div className="w-2.5 h-2.5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
                      ИИ читает...
                    </span>
                  )}
                  {!selected.recognizing && selected.status === "done" && (
                    <span className="flex items-center gap-1.5 text-xs text-positive bg-green-900/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                      <Icon name="Sparkles" size={12} /> Распознано
                    </span>
                  )}
                  {!selected.recognizing && selected.status === "error" && (
                    <span className="flex items-center gap-1.5 text-xs text-negative bg-red-900/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                      <Icon name="AlertCircle" size={12} /> Ошибка
                    </span>
                  )}
                  {!selected.recognizing && selected.previewUrl && (
                    <button onClick={recognizeAgain}
                      title="Распознать заново"
                      className="flex items-center gap-1.5 text-xs text-gold bg-gold/10 hover:bg-gold/20 px-2.5 py-1 rounded-full whitespace-nowrap transition-colors active:scale-95">
                      <Icon name="RefreshCw" size={12} />
                      <span className="hidden sm:inline">Заново</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Document preview */}
              {selected.previewUrl && (
                <div className="mb-3 rounded-lg overflow-hidden border border-border bg-secondary/30">
                  <img
                    src={selected.previewUrl}
                    alt="Документ"
                    className="w-full max-h-52 object-contain"
                  />
                </div>
              )}

              {selected.recognizing && (
                <div className="flex flex-col items-center justify-center gap-3 py-6">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full border-4 border-border border-t-gold animate-spin" />
                    <Icon name="Sparkles" size={18} className="text-gold absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <div className="text-sm font-medium">ИИ анализирует документ</div>
                  <div className="text-xs text-muted-foreground text-center max-w-xs">Извлекаю сумму, дату, контрагента и категорию...</div>
                </div>
              )}

              {!selected.recognizing && selected.status === "error" && (
                <div className="flex flex-col items-center justify-center gap-3 py-6">
                  <Icon name="AlertCircle" size={32} className="text-negative" />
                  <div className="text-sm text-negative text-center">{selected.recognitionError || "Не удалось распознать документ"}</div>
                  <div className="text-xs text-muted-foreground text-center">Убедитесь что добавлен API ключ в Настройках</div>
                </div>
              )}

              {selDone && (
                <div className="space-y-2.5">
                  {/* Auto-created transaction banner */}
                  {selected.recognition?.transaction_id && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-green-900/20 border border-green-900/30 animate-fade-in">
                      <Icon name="CheckCircle" size={16} className="text-positive flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-positive">Операция создана автоматически</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {selected.recognition.category} • {selected.recognition.amount_str || ""}
                          {!selected.recognition.date_found && " • Дата не найдена — поставлена сегодня"}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning if amount not found — tx not created */}
                  {!selected.recognition?.transaction_id && !selected.recognition?.error && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-900/20 border border-yellow-900/30">
                      <Icon name="AlertTriangle" size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-yellow-300 mb-2">Сумма не распознана — заполните вручную или попробуйте распознать заново</div>
                        {selected.previewUrl && (
                          <button onClick={recognizeAgain}
                            className="inline-flex items-center gap-1.5 text-xs bg-gold/15 hover:bg-gold/25 text-gold px-3 py-1.5 rounded-full transition-colors active:scale-95">
                            <Icon name="RefreshCw" size={12} />
                            Распознать заново
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {[
                    { label: "Тип документа", value: selected.rec_type, field: "rec_type", icon: "FileType" },
                    { label: "Контрагент / Поставщик", value: selected.rec_counterparty, field: "rec_counterparty", icon: "Building2" },
                    { label: "ИНН", value: selected.rec_inn, field: "rec_inn", icon: "Hash" },
                    { label: "Дата документа", value: selected.rec_date, field: "rec_date", icon: "Calendar" },
                    { label: "Сумма", value: selected.rec_amount, field: "rec_amount", icon: "Banknote" },
                  ].filter((f) => f.value).map((field) => (
                    <EditableField key={field.label} label={field.label} value={field.value!}
                      icon={field.icon} onSave={(v) => handleFieldUpdate(field.field, v)} />
                  ))}

                  {selected.recognition?.category && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-muted-foreground">Статья затрат:</span>
                      <span className="text-xs bg-gold/15 text-gold px-2.5 py-1 rounded-full font-medium">{selected.recognition.category}</span>
                    </div>
                  )}

                  {selected.recognition?.description && (
                    <div className="card-fin-raised p-3 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Описание</div>
                      <div className="text-sm leading-relaxed">{selected.recognition.description}</div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    {/* Show "create tx" only if not auto-created */}
                    {!selected.recognition?.transaction_id && (
                      <button onClick={openCreateTx}
                        className="flex-1 py-3 sm:py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors active:scale-95 flex items-center justify-center gap-2">
                        <Icon name="Plus" size={15} />
                        <span className="hidden sm:inline">Создать операцию вручную</span>
                        <span className="sm:hidden">Создать операцию</span>
                      </button>
                    )}
                    {selected.recognition?.transaction_id && (
                      <button onClick={openCreateTx}
                        className="flex-1 py-3 sm:py-2.5 border border-border text-muted-foreground rounded text-sm hover:text-foreground hover:border-gold/40 transition-colors flex items-center justify-center gap-2">
                        <Icon name="Pencil" size={14} />
                        Исправить операцию
                      </button>
                    )}
                    <button onClick={() => handleDelete(selected.id)}
                      className="px-4 py-3 sm:py-2.5 border border-red-900/40 text-negative rounded text-sm hover:bg-red-900/20 transition-colors flex-shrink-0">
                      <Icon name="Trash2" size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 py-8">
              <Icon name="ScanLine" size={36} className="opacity-40" />
              <div className="text-sm">Загрузите или сфотографируйте документ</div>
              <div className="text-xs text-center max-w-xs">ИИ автоматически извлечёт сумму, дату и контрагента</div>
            </div>
          )}
        </div>
      </div>

      {/* Create transaction modal */}
      {showTxModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowTxModal(false)}>
          <div className="w-full sm:max-w-md card-fin rounded-t-2xl sm:rounded-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Создать операцию-расход</h2>
                <div className="text-xs text-muted-foreground mt-0.5">Данные заполнены ИИ, можно исправить</div>
              </div>
              <button onClick={() => setShowTxModal(false)} className="text-muted-foreground hover:text-foreground"><Icon name="X" size={18} /></button>
            </div>

            {/* Document preview in modal */}
            {selected?.previewUrl && (
              <div className="rounded-lg overflow-hidden border border-border bg-secondary/30">
                <div className="text-xs text-muted-foreground px-2 py-1 border-b border-border">Документ</div>
                <img src={selected.previewUrl} alt="Документ" className="w-full max-h-40 object-contain" />
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Описание</label>
                <input value={txForm.description} onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Сумма (₽)</label>
                  <input type="number" value={txForm.amount} onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Дата</label>
                  <input type="date" value={txForm.date} onChange={(e) => setTxForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Категория расхода</label>
                <select value={txForm.category} onChange={(e) => setTxForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="bg-secondary/60 rounded-lg p-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Icon name="TrendingDown" size={13} className="text-negative flex-shrink-0" />
              Тип: <strong className="text-negative ml-1">Расход</strong>
              {txForm.amount && <span className="ml-auto font-mono-fin text-negative font-medium">−{fmt(Number(txForm.amount))}</span>}
            </div>
            <button onClick={handleCreateTx} disabled={txSaving || txSaved || !txForm.amount || !txForm.description}
              className={`w-full py-2.5 rounded text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${txSaved ? "bg-positive text-white" : "bg-gold text-primary-foreground hover:bg-yellow-500"}`}>
              {txSaving
                ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                : txSaved
                  ? <><Icon name="CheckCircle" size={15} />Операция создана!</>
                  : <><Icon name="Plus" size={15} />Создать расход</>}
            </button>
          </div>
        </div>
      )}

      {/* ═══ Мультистраничный модал ═══ */}
      {showMultiModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget && pages.length === 0) setShowMultiModal(false); }}>
          <div className="flex items-center justify-between px-4 pt-5 pb-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Сфотографировать накладную</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Добавьте все страницы, затем нажмите «Готово»</p>
            </div>
            <button onClick={() => { setShowMultiModal(false); setPages([]); }}
              className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
              <Icon name="X" size={16} />
            </button>
          </div>

          {/* Pages grid */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                <Icon name="ScanLine" size={40} className="opacity-30" />
                <p className="text-sm">Нет страниц — нажмите камеру ниже</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                {pages.map((p, idx) => (
                  <div key={idx} className="relative rounded-xl overflow-hidden border border-border bg-secondary aspect-[3/4]">
                    <img src={p.previewUrl} alt={`Страница ${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-md font-medium">
                      {idx + 1}
                    </div>
                    <button onClick={() => removePage(idx)}
                      className="absolute top-1.5 right-1.5 w-8 h-8 bg-red-600/90 text-white rounded-full flex items-center justify-center active:scale-90 transition-transform">
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                ))}
                {/* Add more button */}
                <button onClick={() => multiCameraRef.current?.click()}
                  className="aspect-[3/4] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-gold/50 hover:text-gold transition-colors">
                  <Icon name="Plus" size={24} />
                  <span className="text-xs">Ещё страница</span>
                </button>
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div className="px-4 pb-6 pt-2 space-y-2 border-t border-border bg-card">
            {pages.length === 0 ? (
              <button onClick={() => multiCameraRef.current?.click()}
                className="w-full py-4 bg-gold text-primary-foreground rounded-xl text-base font-semibold flex items-center justify-center gap-3 active:scale-95 transition-transform">
                <Icon name="Camera" size={22} />
                Сфотографировать страницу
              </button>
            ) : (
              <>
                <button onClick={() => multiCameraRef.current?.click()}
                  className="w-full py-3 border border-border text-muted-foreground rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:border-gold/40 hover:text-foreground transition-colors">
                  <Icon name="Plus" size={16} />
                  Добавить ещё страницу
                </button>
                <button onClick={handleMultiDone} disabled={multiProcessing}
                  className="w-full py-4 bg-gold text-primary-foreground rounded-xl text-base font-semibold flex items-center justify-center gap-3 disabled:opacity-60 active:scale-95 transition-transform">
                  {multiProcessing
                    ? <><div className="w-5 h-5 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" /> Отправляю ИИ...</>
                    : <><Icon name="CheckCircle" size={22} /> Готово — {pages.length} {pages.length === 1 ? "страница" : pages.length < 5 ? "страницы" : "страниц"}</>}
                </button>
              </>
            )}
            <p className="text-center text-xs text-muted-foreground">
              {pages.length > 0 ? `${pages.length} стр. добавлено • ИИ обработает все сразу` : "Камера откроется автоматически"}
            </p>
          </div>
        </div>
      )}
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
            onKeyDown={(e) => e.key === "Enter" && save()} autoFocus
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