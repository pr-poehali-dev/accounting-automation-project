import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api, fmt, type DocRecord, type RecognizeResult } from "@/lib/api";

const DEFAULT_CATEGORIES = ["Закупка товара", "Услуги", "Аренда", "Зарплаты", "Оборудование", "Маркетинг", "Логистика", "Прочее"];
const CUSTOM_CATEGORIES_KEY = "custom_categories_v1";
const loadCustomCategories = (): string[] => {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) || "[]"); } catch { return []; }
};
const saveCustomCategory = (name: string) => {
  const existing = loadCustomCategories();
  if (!existing.includes(name)) localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify([...existing, name]));
};

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

/** CamScanner-стиль обработка изображения документа:
 *  1) масштабирование до maxSize по длинной стороне,
 *  2) повышение контраста + lightness boost,
 *  3) unsharp mask (резкость),
 *  4) JPEG высокого качества.
 *  Возвращает base64 (без префикса) и data URL для превью. */
function compressImageToBase64(
  file: File,
  maxSize = 2400,
  quality = 0.92,
  enhance = true,
): Promise<{ b64: string; mime: string; previewUrl: string }> {
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
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, width, height);

      if (enhance) {
        try {
          // 1. Авто-уровни + контраст + лёгкое осветление "бумаги"
          const imgData = ctx.getImageData(0, 0, width, height);
          const d = imgData.data;
          // Сначала находим распределение яркости
          let min = 255, max = 0;
          const step = Math.max(1, Math.floor(d.length / 40000)); // выборка
          for (let i = 0; i < d.length; i += 4 * step) {
            const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (y < min) min = y;
            if (y > max) max = y;
          }
          // Растягиваем гистограмму (с защитой)
          const lo = Math.max(0, min - 8);
          const hi = Math.min(255, max + 8);
          const range = Math.max(40, hi - lo);
          const contrast = 1.25;
          const midGray = 128;
          for (let i = 0; i < d.length; i += 4) {
            for (let c = 0; c < 3; c++) {
              let v = ((d[i + c] - lo) * 255) / range;
              v = (v - midGray) * contrast + midGray;
              if (v < 0) v = 0;
              if (v > 255) v = 255;
              d[i + c] = v;
            }
          }
          ctx.putImageData(imgData, 0, 0);

          // 2. Резкость (unsharp mask лёгкий) через двойной draw с blur
          const blurCanvas = document.createElement("canvas");
          blurCanvas.width = width; blurCanvas.height = height;
          const bctx = blurCanvas.getContext("2d")!;
          bctx.filter = "blur(1.2px)";
          bctx.drawImage(canvas, 0, 0);
          // Накладываем: original + (original - blurred) * amount
          ctx.globalCompositeOperation = "difference";
          ctx.drawImage(blurCanvas, 0, 0);
          ctx.globalCompositeOperation = "source-over";
          // diff теперь в канвасе — но нам нужно: original + diff*0.6.
          // Простая альтернатива: используем CSS filter contrast/saturate напрямую.
          // Сбрасываем — перерисовываем оригинал с CSS-фильтрами поверх уже улучшенного
          ctx.clearRect(0, 0, width, height);
          ctx.putImageData(imgData, 0, 0);
          // Финальный pass через фильтр для резкости
          const finalCanvas = document.createElement("canvas");
          finalCanvas.width = width; finalCanvas.height = height;
          const fctx = finalCanvas.getContext("2d")!;
          fctx.filter = "contrast(1.05) saturate(0.85) brightness(1.03)";
          fctx.drawImage(canvas, 0, 0);
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(finalCanvas, 0, 0);
        } catch {
          // если ImageData недоступен (CORS) — просто возвращаем исходник
        }
      }

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

  // Диалог объединения нескольких фото
  const [mergeDialog, setMergeDialog] = useState<{ images: File[]; nonImages: File[] } | null>(null);

  // Кастомные категории
  const [customCategories, setCustomCategories] = useState<string[]>(loadCustomCategories);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatInput, setNewCatInput] = useState("");

  // Инлайн-редактирование статьи затрат в карточке документа
  const [editingCategory, setEditingCategory] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [newCatInline, setNewCatInline] = useState("");
  const [addingCatInline, setAddingCatInline] = useState(false);

  // localStorage helpers для хранения превью между сессиями
  // Сжимаем превью до меньшего размера перед сохранением (localStorage квота ~5MB)
  const savePreviewSmall = async (docId: number, dataUrl: string) => {
    if (!dataUrl.startsWith("data:")) return;
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("img"));
        img.src = dataUrl;
      });
      let { width, height } = img;
      const max = 900;
      if (width > max || height > max) {
        if (width > height) { height = Math.round((height * max) / width); width = max; }
        else { width = Math.round((width * max) / height); height = max; }
      }
      const cv = document.createElement("canvas");
      cv.width = width; cv.height = height;
      cv.getContext("2d")!.drawImage(img, 0, 0, width, height);
      const small = cv.toDataURL("image/jpeg", 0.78);
      localStorage.setItem(`doc_preview_${docId}`, small);
    } catch {
      try { localStorage.setItem(`doc_preview_${docId}`, dataUrl); } catch { /* ignore */ }
    }
  };
  const savePreview = (docId: number, url: string) => {
    if (!url.startsWith("data:")) return;
    savePreviewSmall(docId, url);
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
        // CamScanner-обработка: высокое разрешение, контраст, резкость
        const compressed = await compressImageToBase64(file, 2400, 0.92, true);
        // Параллельно загружаем обработанное изображение в S3, чтобы можно было поделиться
        api.uploadDoc({
          file_b64: compressed.b64,
          file_name: `scan_${docId}.jpg`,
          mime_type: "image/jpeg",
          doc_id: docId,
        }).then((r) => {
          if (r.duplicate) {
            const dateStr = r.existing_date ? ` от ${r.existing_date.slice(0, 10)}` : "";
            alert(`⚠️ Этот файл уже загружен!\n\nДокумент: «${r.existing_name}»${dateStr}\n\nДубликат не сохранён.`);
          }
        }).catch(() => { /* не блокируем распознавание если S3 не настроен */ });
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

  const addFilesAsMultiPage = async (files: File[]) => {
    try {
      const compressedPages = await Promise.all(
        files.map(async (file) => {
          const c = await compressImageToBase64(file, 1600, 0.75, true);
          return { file, previewUrl: c.previewUrl, b64: c.b64, mime: c.mime };
        }),
      );
      const totalSize = files.reduce((s, f) => s + f.size, 0);
      const sizeMb = (totalSize / 1024 / 1024).toFixed(1);
      const docName = `Накладная (${compressedPages.length} стр.)`;

      const res = await api.documents.create({
        name: docName,
        size_label: `${sizeMb} МБ`,
        status: "processing",
      });

      const combinedPreview = compressedPages[0].previewUrl;
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

      if (compressedPages[0]?.b64) {
        api.uploadDoc({
          file_b64: compressedPages[0].b64,
          file_name: `scan_${res.document.id}.jpg`,
          mime_type: "image/jpeg",
          doc_id: res.document.id,
        }).catch(() => {});
      }

      const images = compressedPages.map((p) => ({ b64: p.b64, mime: p.mime }));
      await recognizeMultiPage(res.document.id, images, combinedPreview, docName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка обработки";
      alert(`Не удалось обработать страницы: ${msg}`);
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

    // Если выбрано несколько изображений — предлагаем склеить как один документ (страницы одной накладной)
    const images = accepted.filter((f) => isImage(f.name));
    const nonImages = accepted.filter((f) => !isImage(f.name));
    if (images.length >= 2) {
      setMergeDialog({ images, nonImages });
      return;
    }

    for (const f of accepted) {
      await processSingleFile(f);
    }
  };

  const processSingleFile = async (f: File) => {
    let previewUrl: string | undefined;
    if (isImage(f.name)) {
      try {
        const compressed = await compressImageToBase64(f, 2400, 0.92, true);
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
    if (previewUrl) savePreview(res.document.id, previewUrl);
    const newDoc: DocWithRecognition = { ...res.document, status: "processing", recognizing: true, previewUrl };
    setDocs((prev) => [newDoc, ...prev]);
    setSelected(newDoc);
    setMobileView("detail");
    recognizeFile(res.document.id, f, previewUrl);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const handleSelect = (doc: DocWithRecognition) => {
    setSelected(doc);
    setEditingCategory(false);
    setAddingCatInline(false);
    setNewCatInline("");
    setMobileView("detail");
  };

  const recognizeAgain = async () => {
    if (!selected) return;
    const imgSrc = selected.previewUrl || selected.s3_url;
    if (!imgSrc) {
      alert("Изображение этого документа не сохранилось — загрузите файл заново для повторного распознавания.");
      return;
    }
    setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, recognizing: true, status: "processing" } : d));
    setSelected((prev) => prev ? { ...prev, recognizing: true, status: "processing" } : prev);
    try {
      let result;
      // Если есть локальный preview (data: URL) — берём его напрямую
      if (selected.previewUrl && selected.previewUrl.startsWith("data:")) {
        const b64 = selected.previewUrl.split(",")[1];
        if (!b64 || b64.length < 200) throw new Error("Изображение повреждено, загрузите файл заново");
        result = await api.recognizeDoc({
          image_b64: b64,
          mime_type: "image/jpeg",
          file_name: selected.name || "document.jpg",
          doc_id: selected.id,
          auto_create_tx: true,
        });
      } else {
        // Нет локального preview — передаём URL на бэкенд, он скачает сам
        result = await api.recognizeDoc({
          image_url: imgSrc,
          file_name: selected.name || "document.jpg",
          doc_id: selected.id,
          auto_create_tx: true,
        });
      }
      if (result.error) throw new Error(result.error);
      await api.documents.update(selected.id, {
        status: "done",
        rec_type: result.doc_type,
        rec_amount: result.amount_str || (result.amount ? `₽ ${result.amount}` : undefined),
        rec_date: result.date || undefined,
        rec_counterparty: result.counterparty || undefined,
        rec_inn: result.inn || undefined,
      });
      const updated = await api.documents.list();
      const updatedDoc = updated.documents.find((d) => d.id === selected.id);
      const finalDoc = { ...(updatedDoc || {}), recognizing: false, recognition: result, previewUrl: selected.previewUrl };
      setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, ...finalDoc } : d));
      setSelected((prev) => prev ? { ...prev, ...finalDoc } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка распознавания";
      await api.documents.update(selected.id, { status: "error" }).catch(() => {});
      setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, status: "error", recognizing: false, recognitionError: msg } : d));
      setSelected((prev) => prev ? { ...prev, status: "error", recognizing: false, recognitionError: msg } : prev);
    }
  };

  const shareDocument = async () => {
    if (!selected) return;
    const url = selected.s3_url;
    const fileName = selected.name || "document.jpg";
    try {
      // Если есть URL в S3 — пробуем поделиться им
      if (url) {
        if (navigator.share) {
          await navigator.share({ title: fileName, text: `Документ: ${fileName}`, url });
          return;
        }
        // Фоллбек: скопировать ссылку
        await navigator.clipboard.writeText(url);
        alert("Ссылка на документ скопирована в буфер обмена");
        return;
      }
      // Если в S3 нет — делимся локальным base64 как файлом
      if (selected.previewUrl && selected.previewUrl.startsWith("data:") && navigator.share) {
        const blob = await (await fetch(selected.previewUrl)).blob();
        const file = new File([blob], fileName, { type: blob.type });
        if ((navigator as { canShare?: (data: { files: File[] }) => boolean }).canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: fileName });
          return;
        }
      }
      alert("Поделиться не получилось. Документ ещё не загружен в облако или ваш браузер не поддерживает функцию.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      if (msg !== "AbortError" && !msg.includes("cancel")) alert(`Не удалось поделиться: ${msg}`);
    }
  };

  const downloadDocument = () => {
    if (!selected) return;
    const url = selected.s3_url || selected.previewUrl;
    if (!url) {
      alert("Файл документа недоступен.");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = selected.name || "document.jpg";
    a.target = "_blank";
    a.click();
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

  const handleCategoryChange = async (newCategory: string) => {
    // transaction_id может быть как из БД (rec_category JOIN), так и из памяти (recognition)
    const txId = selected?.transaction_id || selected?.recognition?.transaction_id;
    if (!txId) return;
    setSavingCategory(true);
    try {
      await api.transactions.update(txId, { category: newCategory });
      // Обновляем оба источника в локальном стейте
      setSelected((prev) => prev ? {
        ...prev,
        rec_category: newCategory,
        recognition: prev.recognition ? { ...prev.recognition, category: newCategory } : prev.recognition,
      } : prev);
      setDocs((prev) => prev.map((d) => d.id === selected!.id ? {
        ...d,
        rec_category: newCategory,
        recognition: d.recognition ? { ...d.recognition, category: newCategory } : d.recognition,
      } : d));
    } finally {
      setSavingCategory(false);
      setEditingCategory(false);
    }
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
    setTxForm({ description: desc || "", amount: rawAmount, date: isoDate, category: selected.rec_category || rec?.category || "Прочее" });
    setTxSaved(false);
    setShowNewCat(false);
    setNewCatInput("");
    setShowTxModal(true);
  };

  const handleCreateTx = async () => {
    if (!txForm.description || !txForm.amount) return;
    setTxSaving(true);
    try {
      const existingTxId = selected?.transaction_id || selected?.recognition?.transaction_id;
      if (existingTxId) {
        // Обновляем существующую транзакцию — не создаём новую
        await api.transactions.update(existingTxId, {
          date: txForm.date,
          description: txForm.description,
          category: txForm.category,
          amount: -Math.abs(Number(txForm.amount)),
          status: "Выполнено",
        });
      } else {
        await api.transactions.create({
          date: txForm.date,
          description: txForm.description,
          category: txForm.category,
          amount: -Math.abs(Number(txForm.amount)),
          status: "Выполнено",
        });
      }
      // Обновляем rec_category в локальном стейте сразу
      const newCat = txForm.category;
      setSelected((prev) => prev ? { ...prev, rec_category: newCat } : prev);
      setDocs((prev) => prev.map((d) => d.id === selected!.id ? { ...d, rec_category: newCat } : d));
      setTxSaved(true);
      setTimeout(() => { setShowTxModal(false); setTxSaved(false); }, 1500);
    } finally {
      setTxSaving(false);
    }
  };

  // ── Мультистраничный режим ──────────────────────────────
  const addPageFromFile = async (file: File) => {
    try {
      const compressed = await compressImageToBase64(file, 1600, 0.75, true);
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
      // Загружаем первую страницу в S3 для возможности поделиться
      if (pages[0]?.b64) {
        api.uploadDoc({
          file_b64: pages[0].b64,
          file_name: `scan_${res.document.id}.jpg`,
          mime_type: "image/jpeg",
          doc_id: res.document.id,
        }).then((r) => {
          if (r.duplicate) {
            const dateStr = r.existing_date ? ` от ${r.existing_date.slice(0, 10)}` : "";
            alert(`⚠️ Этот файл уже загружен!\n\nДокумент: «${r.existing_name}»${dateStr}\n\nДубликат не сохранён.`);
          }
        }).catch(() => { /* не блокируем */ });
      }
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
        <button onClick={() => { setPages([]); setShowMultiModal(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex flex-col items-center justify-center gap-2 p-4 card-fin border-2 border-dashed border-gold/40 rounded-xl text-gold active:scale-95 transition-transform">
          <Icon name="Camera" size={26} />
          <span className="text-sm font-medium">Сфотографировать</span>
          <span className="text-xs text-muted-foreground text-center">1 или несколько страниц</span>
        </button>
        <button onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-4 card-fin border-2 border-dashed border-border/60 rounded-xl text-muted-foreground active:scale-95 transition-transform">
          <Icon name="Upload" size={26} />
          <span className="text-sm font-medium">Загрузить файл</span>
          <span className="text-xs text-center">PDF, JPG, PNG, XLS</span>
          <span className="text-[10px] text-muted-foreground/60 text-center">можно несколько сразу</span>
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
              <div className="text-xs text-muted-foreground">PDF, JPG, PNG, XLS — можно несколько файлов сразу</div>
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
                    {doc.status === "done" && (doc.rec_date || doc.rec_type || doc.rec_amount) ? (
                      <div className="text-[11px] sm:text-xs text-gold/80 truncate leading-tight mt-0.5">
                        {[doc.rec_date, doc.rec_type, doc.rec_amount ? doc.rec_amount + " ₽" : null]
                          .filter(Boolean).join(" · ")}
                      </div>
                    ) : (
                      <div className="text-[11px] sm:text-xs text-muted-foreground">{doc.size_label}</div>
                    )}
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
                  {!selected.recognizing && (selected.previewUrl || selected.s3_url) && (
                    <button onClick={recognizeAgain}
                      title="Распознать заново"
                      className="flex items-center gap-1.5 text-xs text-gold bg-gold/10 hover:bg-gold/20 px-2.5 py-1 rounded-full whitespace-nowrap transition-colors active:scale-95">
                      <Icon name="RefreshCw" size={12} />
                      <span className="hidden sm:inline">Прочитать повторно</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Quick actions: share + download */}
              {(selected.previewUrl || selected.s3_url) && (
                <div className="flex gap-2 mb-3 flex-wrap">
                  <button onClick={shareDocument}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:border-gold/40 hover:bg-gold/5 transition-colors active:scale-95">
                    <Icon name="Share2" size={14} className="text-gold" />
                    Поделиться
                  </button>
                  <button onClick={downloadDocument}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:border-gold/40 hover:bg-gold/5 transition-colors active:scale-95">
                    <Icon name="Download" size={14} className="text-gold" />
                    Скачать
                  </button>
                  {selected.s3_url && (
                    <a href={selected.s3_url} target="_blank" rel="noopener noreferrer"
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:border-gold/40 hover:bg-gold/5 transition-colors active:scale-95">
                      <Icon name="ExternalLink" size={14} className="text-gold" />
                      Открыть
                    </a>
                  )}
                </div>
              )}

              {/* Document preview */}
              {(selected.previewUrl || selected.s3_url) && (
                <div className="mb-3 rounded-lg overflow-hidden border border-border bg-secondary/30">
                  <img
                    src={selected.previewUrl || selected.s3_url}
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
                  {selected.recognition && !selected.recognition.error
                    && !selected.recognition.transaction_id && !selected.transaction_id
                    && !selected.rec_amount && (
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

                  {/* Статья затрат — всегда показываем если есть транзакция */}
                  {(selected.rec_category || selected.recognition?.category || selected.transaction_id || selected.recognition?.transaction_id) && (
                    <div className="card-fin-raised p-3 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-2">Статья затрат</div>
                      {editingCategory ? (
                        <div className="space-y-2">
                          {addingCatInline ? (
                            <div className="flex gap-1.5">
                              <input
                                autoFocus
                                value={newCatInline}
                                onChange={(e) => setNewCatInline(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter" && newCatInline.trim()) {
                                    const name = newCatInline.trim();
                                    saveCustomCategory(name);
                                    setCustomCategories(loadCustomCategories());
                                    await handleCategoryChange(name);
                                    setNewCatInline("");
                                    setAddingCatInline(false);
                                  }
                                  if (e.key === "Escape") { setAddingCatInline(false); setNewCatInline(""); }
                                }}
                                placeholder="Название новой статьи..."
                                className="flex-1 min-w-0 bg-secondary border border-gold rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none"
                              />
                              <button
                                disabled={!newCatInline.trim() || savingCategory}
                                onClick={async () => {
                                  const name = newCatInline.trim();
                                  if (!name) return;
                                  saveCustomCategory(name);
                                  setCustomCategories(loadCustomCategories());
                                  await handleCategoryChange(name);
                                  setNewCatInline("");
                                  setAddingCatInline(false);
                                }}
                                className="px-2.5 py-1.5 bg-gold text-primary-foreground rounded text-sm disabled:opacity-50"
                              >
                                <Icon name="Check" size={14} />
                              </button>
                              <button onClick={() => { setAddingCatInline(false); setNewCatInline(""); }}
                                className="px-2.5 py-1.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground">
                                <Icon name="X" size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1.5">
                              <select
                                value={selected.rec_category || selected.recognition?.category || ""}
                                disabled={savingCategory}
                                onChange={(e) => {
                                  if (e.target.value === "__new__") {
                                    setAddingCatInline(true);
                                  } else {
                                    handleCategoryChange(e.target.value);
                                  }
                                }}
                                className="flex-1 min-w-0 bg-secondary border border-gold rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
                              >
                                {[...DEFAULT_CATEGORIES, ...customCategories].map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                                <option value="__new__">+ Создать свою...</option>
                              </select>
                              {savingCategory
                                ? <Icon name="Loader" size={16} className="animate-spin text-gold flex-shrink-0 self-center" />
                                : <button onClick={() => { setEditingCategory(false); setAddingCatInline(false); }}
                                    className="px-2.5 py-1.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground flex-shrink-0">
                                    <Icon name="X" size={14} />
                                  </button>
                              }
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingCategory(true); setAddingCatInline(false); }}
                          className="flex items-center gap-1.5 text-sm bg-gold/15 hover:bg-gold/25 text-gold px-3 py-1.5 rounded-lg font-medium transition-colors w-full justify-between group"
                        >
                          <span>{selected.rec_category || selected.recognition?.category || "Не указана"}</span>
                          <Icon name="ChevronDown" size={14} className="opacity-60 group-hover:opacity-100 flex-shrink-0" />
                        </button>
                      )}
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
                    {!(selected.transaction_id || selected.recognition?.transaction_id) && (
                      <button onClick={openCreateTx}
                        className="flex-1 py-3 sm:py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors active:scale-95 flex items-center justify-center gap-2">
                        <Icon name="Plus" size={15} />
                        <span className="hidden sm:inline">Создать операцию вручную</span>
                        <span className="sm:hidden">Создать операцию</span>
                      </button>
                    )}
                    {(selected.transaction_id || selected.recognition?.transaction_id) && (
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
                <h2 className="text-sm font-semibold">{(selected?.transaction_id || selected?.recognition?.transaction_id) ? "Исправить операцию" : "Создать операцию-расход"}</h2>
                <div className="text-xs text-muted-foreground mt-0.5">{(selected?.transaction_id || selected?.recognition?.transaction_id) ? "Изменения сохранятся в существующей операции" : "Данные заполнены ИИ, можно исправить"}</div>
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
                {showNewCat ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={newCatInput}
                      onChange={(e) => setNewCatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newCatInput.trim()) {
                          const name = newCatInput.trim();
                          saveCustomCategory(name);
                          setCustomCategories(loadCustomCategories());
                          setTxForm((f) => ({ ...f, category: name }));
                          setNewCatInput(""); setShowNewCat(false);
                        }
                        if (e.key === "Escape") { setShowNewCat(false); setNewCatInput(""); }
                      }}
                      placeholder="Название категории..."
                      className="flex-1 min-w-0 bg-secondary border border-gold rounded px-2 py-2 text-sm text-foreground focus:outline-none"
                    />
                    <button type="button" onClick={() => {
                      if (newCatInput.trim()) {
                        const name = newCatInput.trim();
                        saveCustomCategory(name);
                        setCustomCategories(loadCustomCategories());
                        setTxForm((f) => ({ ...f, category: name }));
                        setNewCatInput(""); setShowNewCat(false);
                      }
                    }} className="px-2 py-2 bg-gold text-primary-foreground rounded text-sm">
                      <Icon name="Check" size={14} />
                    </button>
                  </div>
                ) : (
                  <select value={txForm.category} onChange={(e) => {
                    if (e.target.value === "__new__") { setShowNewCat(true); }
                    else setTxForm((f) => ({ ...f, category: e.target.value }));
                  }} className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                    {[...DEFAULT_CATEGORIES, ...customCategories].map((c) => <option key={c}>{c}</option>)}
                    <option value="__new__">+ Своя категория...</option>
                  </select>
                )}
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

      {/* ═══ Диалог объединения фото ═══ */}
      {mergeDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-4 animate-fade-in">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-3">
                <Icon name="Images" size={22} className="text-gold" />
              </div>
              <div className="font-semibold text-base">Выбрано {mergeDialog.images.length} фото</div>
              <div className="text-sm text-muted-foreground mt-1">Это разные страницы одного документа или отдельные документы?</div>
            </div>
            <button
              onClick={async () => {
                const { images, nonImages } = mergeDialog;
                setMergeDialog(null);
                await addFilesAsMultiPage(images.slice(0, 5));
                for (const f of nonImages) await processSingleFile(f);
              }}
              className="w-full py-3 bg-gold text-black font-semibold rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform">
              <Icon name="BookOpen" size={18} />
              Один документ (страницы)
            </button>
            <button
              onClick={async () => {
                const { images, nonImages } = mergeDialog;
                setMergeDialog(null);
                for (const f of [...images, ...nonImages]) await processSingleFile(f);
              }}
              className="w-full py-3 border border-border rounded-xl text-sm text-foreground flex items-center justify-center gap-2 active:scale-95 transition-transform hover:border-gold/40">
              <Icon name="Files" size={18} />
              Отдельные документы
            </button>
            <button onClick={() => setMergeDialog(null)} className="w-full text-sm text-muted-foreground py-1">
              Отмена
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
          <div className="px-4 pt-2 space-y-2 border-t border-border bg-card" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}>
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