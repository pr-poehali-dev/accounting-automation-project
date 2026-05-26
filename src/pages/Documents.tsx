import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api } from "@/lib/api";
import {
  DEFAULT_CATEGORIES, CUSTOM_CATEGORIES_KEY,
  loadCustomCategories, saveCustomCategory,
  isImage, isExcel, isSupported,
  fileToBase64, compressImageToBase64,
} from "@/components/documents/docTypes";
import type { DocWithRecognition, PageItem } from "@/components/documents/docTypes";
import DocList from "@/components/documents/DocList";
import DocDetail from "@/components/documents/DocDetail";
import { MergeDialog, DeleteDialog, TxModal, MultiModal, ManualDocModal } from "@/components/documents/DocModals";
import type { ManualDocForm } from "@/components/documents/DocModals";

// ── localStorage preview helpers ─────────────────────────────
const savePreviewSmall = async (docId: number, dataUrl: string) => {
  if (!dataUrl.startsWith("data:")) return;
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res(); img.onerror = () => rej(new Error("img")); img.src = dataUrl;
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
const savePreview = (docId: number, url: string) => { if (url.startsWith("data:")) savePreviewSmall(docId, url); };
const loadPreview = (docId: number): string | undefined => {
  try { const v = localStorage.getItem(`doc_preview_${docId}`); return (v && v.startsWith("data:")) ? v : undefined; } catch { return undefined; }
};
const removePreview = (docId: number) => { try { localStorage.removeItem(`doc_preview_${docId}`); } catch { /* ignore */ } };

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
  const reuploadRef = useRef<HTMLInputElement>(null);

  const [showMultiModal, setShowMultiModal] = useState(false);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [multiProcessing, setMultiProcessing] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  // Очередь файлов для пакетной загрузки (iOS-совместимость)
  const [fileQueue, setFileQueue] = useState<File[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const queueInputRef = useRef<HTMLInputElement>(null);

  const [mergeDialog, setMergeDialog] = useState<{ images: File[]; nonImages: File[] } | null>(null);

  const [customCategories, setCustomCategories] = useState<string[]>(loadCustomCategories);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatInput, setNewCatInput] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [editingCategory, setEditingCategory] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [newCatInline, setNewCatInline] = useState("");
  const [addingCatInline, setAddingCatInline] = useState(false);

  const [showManualModal, setShowManualModal] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);

  // ── Load ─────────────────────────────────────────────────
  const loadDocs = async () => {
    try {
      const res = await api.documents.list();
      const withPreviews = res.documents.map((d) => ({ ...d, previewUrl: loadPreview(d.id) }));
      setDocs(withPreviews);
      if (withPreviews.length > 0) setSelected(withPreviews[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
    api.categories.list().then((res) => {
      const dbNames = res.categories.map((c) => c.name);
      const local = loadCustomCategories();
      const merged = [...new Set([...dbNames, ...local])];
      const custom = merged.filter((n) => !DEFAULT_CATEGORIES.includes(n));
      localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(custom));
      setCustomCategories(custom);
    }).catch(() => {});
  }, []);

  // ── Recognize single file ────────────────────────────────
  const recognizeFile = async (docId: number, file: File, previewUrl?: string, alreadyUploadedUrl?: string) => {
    setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, recognizing: true, previewUrl } : d));
    setSelected((prev) => prev?.id === docId ? { ...prev, recognizing: true, previewUrl } : prev);
    try {
      let result;
      if (isImage(file.name)) {
        const compressed = await compressImageToBase64(file, 2400, 0.92, true);
        if (!alreadyUploadedUrl) {
          api.uploadDoc({ file_b64: compressed.b64, file_name: `scan_${docId}.jpg`, mime_type: "image/jpeg", doc_id: docId }).catch(() => {});
        }
        result = await api.recognizeDoc({ image_b64: compressed.b64, mime_type: compressed.mime, file_name: file.name, doc_id: docId, auto_create_tx: true });
      } else if (isExcel(file.name)) {
        const b64 = await fileToBase64(file);
        result = await api.recognizeDoc({ excel_b64: b64, file_name: file.name, doc_id: docId, auto_create_tx: true });
      } else {
        result = await api.recognizeDoc({ file_name: file.name, doc_id: docId, auto_create_tx: true });
      }
      if (result.duplicate) {
        alert(`⚠️ Возможный дубль!\n\nДокумент с суммой ${result.amount?.toLocaleString("ru-RU")} ₽ и датой ${result.date} уже есть:\n«${result.existing_name}»\n\nЗагрузка отменена.`);
        await api.documents.update(docId, { status: "error" }).catch(() => {});
        setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, status: "error", recognizing: false, recognitionError: "Дубль по сумме и дате" } : d));
        setSelected((prev) => prev?.id === docId ? { ...prev, status: "error", recognizing: false, recognitionError: "Дубль по сумме и дате" } : prev);
        return;
      }
      if (!result.error) {
        await api.documents.update(docId, {
          status: "done", rec_type: result.doc_type,
          rec_amount: result.amount_str || (result.amount ? `₽ ${result.amount}` : undefined),
          rec_date: result.date || undefined, rec_counterparty: result.counterparty || undefined, rec_inn: result.inn || undefined,
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

  // ── Recognize multi-page ─────────────────────────────────
  const recognizeMultiPage = async (docId: number, images: { b64: string; mime: string }[], previewUrl: string | undefined, fileName: string) => {
    setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, recognizing: true, previewUrl } : d));
    setSelected((prev) => prev?.id === docId ? { ...prev, recognizing: true, previewUrl } : prev);
    try {
      const result = await api.recognizeDoc({ images, file_name: fileName, doc_id: docId, auto_create_tx: true });
      if (!result.error) {
        await api.documents.update(docId, {
          status: "done", rec_type: result.doc_type,
          rec_amount: result.amount_str || (result.amount ? `₽ ${result.amount}` : undefined),
          rec_date: result.date || undefined, rec_counterparty: result.counterparty || undefined, rec_inn: result.inn || undefined,
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

  // ── Upload single file ───────────────────────────────────
  const processSingleFile = async (f: File) => {
    setUploading(true); setUploadProgress("Загружаю файл в хранилище...");
    try {
      let previewUrl: string | undefined;
      let compressed: { b64: string; mime: string; previewUrl: string } | null = null;
      if (isImage(f.name)) {
        try { compressed = await compressImageToBase64(f, 2400, 0.92, true); previewUrl = compressed.previewUrl; }
        catch { previewUrl = URL.createObjectURL(f); }
      }
      let s3Url: string | undefined;
      if (compressed) {
        const uploadRes = await api.uploadDoc({ file_b64: compressed.b64, file_name: `scan_${Date.now()}.jpg`, mime_type: "image/jpeg" });
        if (uploadRes.duplicate) {
          const dateStr = uploadRes.existing_date ? ` от ${uploadRes.existing_date.slice(0, 10)}` : "";
          alert(`⚠️ Этот файл уже загружен!\n\nДокумент: «${uploadRes.existing_name}»${dateStr}\n\nДубликат не сохранён.`);
          return;
        }
        s3Url = uploadRes.url;
      }
      setUploadProgress("Распознаю документ...");
      const res = await api.documents.create({ name: f.name, size_label: `${(f.size / 1024 / 1024).toFixed(1)} МБ`, status: "processing", ...(s3Url ? { s3_url: s3Url } : {}) });
      if (previewUrl) savePreview(res.document.id, previewUrl);
      const newDoc: DocWithRecognition = { ...res.document, status: "processing", recognizing: true, previewUrl, s3_url: s3Url };
      setDocs((prev) => [newDoc, ...prev]);
      setSelected(newDoc);
      setMobileView("detail");
      recognizeFile(res.document.id, f, previewUrl, s3Url);
    } finally {
      setUploading(false); setUploadProgress("");
    }
  };

  // ── Upload multi-page ────────────────────────────────────
  const addFilesAsMultiPage = async (files: File[]) => {
    setUploading(true); setUploadProgress("Загружаю файл в хранилище...");
    try {
      const compressedPages = await Promise.all(files.map(async (file) => {
        const c = await compressImageToBase64(file, 1600, 0.75, true);
        return { file, previewUrl: c.previewUrl, b64: c.b64, mime: c.mime };
      }));
      const totalSize = files.reduce((s, f) => s + f.size, 0);
      const docName = `Накладная (${compressedPages.length} стр.)`;
      let s3Url: string | undefined;
      if (compressedPages[0]?.b64) {
        const uploadRes = await api.uploadDoc({ file_b64: compressedPages[0].b64, file_name: `scan_${Date.now()}.jpg`, mime_type: "image/jpeg" });
        if (uploadRes.duplicate) {
          const dateStr = uploadRes.existing_date ? ` от ${uploadRes.existing_date.slice(0, 10)}` : "";
          alert(`⚠️ Этот файл уже загружен!\n\nДокумент: «${uploadRes.existing_name}»${dateStr}\n\nДубликат не сохранён.`);
          return;
        }
        s3Url = uploadRes.url;
      }
      setUploadProgress("Распознаю документ...");
      const res = await api.documents.create({ name: docName, size_label: `${(totalSize / 1024 / 1024).toFixed(1)} МБ`, status: "processing", ...(s3Url ? { s3_url: s3Url } : {}) });
      const combinedPreview = compressedPages[0].previewUrl;
      if (combinedPreview) savePreview(res.document.id, combinedPreview);
      const newDoc: DocWithRecognition = { ...res.document, status: "processing", recognizing: true, previewUrl: combinedPreview, s3_url: s3Url };
      setDocs((prev) => [newDoc, ...prev]); setSelected(newDoc); setMobileView("detail");
      const images = compressedPages.map((p) => ({ b64: p.b64, mime: p.mime }));
      await recognizeMultiPage(res.document.id, images, combinedPreview, docName);
    } catch (err) {
      alert(`Не удалось обработать страницы: ${err instanceof Error ? err.message : "Ошибка"}`);
    } finally {
      setUploading(false); setUploadProgress("");
    }
  };

  const addFiles = async (files: File[]) => {
    const skipped = files.filter((f) => !isSupported(f.name));
    if (skipped.length) alert(`Не поддерживается: ${skipped.map((f) => f.name).join(", ")}\n\nИИ распознаёт: PDF, JPG, PNG, XLS, XLSX.`);
    const accepted = files.filter((f) => isSupported(f.name));
    const images = accepted.filter((f) => isImage(f.name));
    const nonImages = accepted.filter((f) => !isImage(f.name));
    if (images.length >= 2) { setMergeDialog({ images, nonImages }); return; }
    for (const f of accepted) await processSingleFile(f);
  };

  const handleReupload = async (file: File) => {
    if (!selected) return;
    if (!isImage(file.name)) { alert("Загрузите фото (JPG, PNG)"); return; }
    const compressed = await compressImageToBase64(file, 2400, 0.92, true);
    const r = await api.uploadDoc({ file_b64: compressed.b64, file_name: `scan_${selected.id}.jpg`, mime_type: "image/jpeg", doc_id: selected.id });
    if (r.url) {
      savePreviewSmall(selected.id, compressed.previewUrl);
      setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, s3_url: r.url, previewUrl: compressed.previewUrl } : d));
      setSelected((prev) => prev ? { ...prev, s3_url: r.url, previewUrl: compressed.previewUrl } : prev);
    }
  };

  const handleSelect = (doc: DocWithRecognition) => {
    setSelected(doc); setEditingCategory(false); setAddingCatInline(false); setNewCatInline(""); setMobileView("detail");
  };

  const recognizeAgain = async () => {
    if (!selected) return;
    const imgSrc = selected.previewUrl || selected.s3_url;
    if (!imgSrc) { alert("Изображение этого документа не сохранилось — загрузите файл заново."); return; }
    setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, recognizing: true, status: "processing" } : d));
    setSelected((prev) => prev ? { ...prev, recognizing: true, status: "processing" } : prev);
    try {
      let result;
      if (selected.previewUrl && selected.previewUrl.startsWith("data:")) {
        const b64 = selected.previewUrl.split(",")[1];
        if (!b64 || b64.length < 200) throw new Error("Изображение повреждено, загрузите файл заново");
        result = await api.recognizeDoc({ image_b64: b64, mime_type: "image/jpeg", file_name: selected.name || "document.jpg", doc_id: selected.id, auto_create_tx: true });
      } else {
        result = await api.recognizeDoc({ image_url: imgSrc, file_name: selected.name || "document.jpg", doc_id: selected.id, auto_create_tx: true });
      }
      if (result.error) throw new Error(result.error);
      await api.documents.update(selected.id, {
        status: "done", rec_type: result.doc_type,
        rec_amount: result.amount_str || (result.amount ? `₽ ${result.amount}` : undefined),
        rec_date: result.date || undefined, rec_counterparty: result.counterparty || undefined, rec_inn: result.inn || undefined,
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
      if (url) {
        if (navigator.share) { await navigator.share({ title: fileName, text: `Документ: ${fileName}`, url }); return; }
        await navigator.clipboard.writeText(url);
        alert("Ссылка на документ скопирована в буфер обмена"); return;
      }
      if (selected.previewUrl && selected.previewUrl.startsWith("data:") && navigator.share) {
        const blob = await (await fetch(selected.previewUrl)).blob();
        const file = new File([blob], fileName, { type: blob.type });
        if ((navigator as { canShare?: (data: { files: File[] }) => boolean }).canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: fileName }); return;
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
    if (!url) { alert("Файл документа недоступен."); return; }
    const a = document.createElement("a");
    a.href = url; a.download = selected.name || "document.jpg"; a.target = "_blank"; a.click();
  };

  const handleDelete = (id: number) => {
    setDeleteConfirmId(id);
    // Прокручиваем страницу в начало чтобы модалка была по центру экрана
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    await api.documents.delete(id);
    removePreview(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    if (selected?.id === id) { setSelected(null); setMobileView("list"); }
  };

  const handleFieldUpdate = async (field: string, value: string) => {
    if (!selected) return;
    const updated = await api.documents.update(selected.id, { [field]: value });
    setDocs((prev) => prev.map((d) => d.id === selected.id ? { ...d, ...updated.document } : d));
    setSelected((prev) => prev ? { ...prev, ...updated.document } : prev);
  };

  const handleCashlessToggle = async (id: number, value: boolean) => {
    await api.documents.update(id, { is_cashless: value });
    setDocs((prev) => prev.map((d) => d.id === id ? { ...d, is_cashless: value } : d));
    setSelected((prev) => prev?.id === id ? { ...prev, is_cashless: value } : prev);
  };

  const handleManualDoc = async (form: ManualDocForm) => {
    setManualSaving(true);
    try {
      const docName = form.name.trim() || `Расход ${form.date}`;
      const docRes = await api.documents.create({
        name: docName,
        status: "done",
        rec_amount: `₽ ${form.amount}`,
        rec_date: form.date,
        rec_type: "Ручная запись",
        is_cashless: form.is_cashless,
      });
      await api.transactions.create({
        date: form.date,
        description: form.description || docName,
        category: form.category,
        amount: -Math.abs(Number(form.amount)),
        status: "Выполнено",
        document_id: docRes.document.id,
        is_cashless: form.is_cashless,
      } as Parameters<typeof api.transactions.create>[0]);
      const newDoc: DocWithRecognition = {
        ...docRes.document,
        rec_category: form.category,
        is_cashless: form.is_cashless,
      };
      setDocs((prev) => [newDoc, ...prev]);
      setSelected(newDoc);
      setMobileView("detail");
      setShowManualModal(false);
    } finally {
      setManualSaving(false);
    }
  };

  const handleCategoryChange = async (newCategory: string) => {
    const txId = selected?.transaction_id || selected?.recognition?.transaction_id;
    if (!txId) return;
    setSavingCategory(true);
    try {
      await api.transactions.update(txId, { category: newCategory });
      setSelected((prev) => prev ? { ...prev, rec_category: newCategory, recognition: prev.recognition ? { ...prev.recognition, category: newCategory } : prev.recognition } : prev);
      setDocs((prev) => prev.map((d) => d.id === selected!.id ? { ...d, rec_category: newCategory, recognition: d.recognition ? { ...d.recognition, category: newCategory } : d.recognition } : d));
    } finally {
      setSavingCategory(false); setEditingCategory(false);
    }
  };

  const openCreateTx = () => {
    if (!selected) return;
    const rec = selected.recognition;
    const rawAmount = rec?.amount ? String(rec.amount) : (selected.rec_amount || "").replace(/[^\d.,]/g, "").replace(",", ".");
    const recDate = rec?.date || selected.rec_date || "";
    let isoDate = new Date().toISOString().split("T")[0];
    if (recDate) {
      const parts = recDate.split(".");
      if (parts.length === 3) isoDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      else if (recDate.includes("-")) isoDate = recDate.split("T")[0];
    }
    const desc = rec?.description || (selected.rec_counterparty ? `${selected.rec_type || "Оплата"} — ${selected.rec_counterparty}` : selected.rec_type || selected.name);
    setTxForm({ description: desc || "", amount: rawAmount, date: isoDate, category: selected.rec_category || rec?.category || "Прочее" });
    setTxSaved(false); setShowNewCat(false); setNewCatInput(""); setShowTxModal(true);
  };

  const handleCreateTx = async () => {
    if (!txForm.description || !txForm.amount) return;
    setTxSaving(true);
    try {
      const existingTxId = selected?.transaction_id || selected?.recognition?.transaction_id;
      if (existingTxId) {
        await api.transactions.update(existingTxId, { date: txForm.date, description: txForm.description, category: txForm.category, amount: -Math.abs(Number(txForm.amount)), status: "Выполнено" });
      } else {
        await api.transactions.create({ date: txForm.date, description: txForm.description, category: txForm.category, amount: -Math.abs(Number(txForm.amount)), status: "Выполнено" });
      }
      const newCat = txForm.category;
      setSelected((prev) => prev ? { ...prev, rec_category: newCat } : prev);
      setDocs((prev) => prev.map((d) => d.id === selected!.id ? { ...d, rec_category: newCat } : d));
      setTxSaved(true);
      setTimeout(() => { setShowTxModal(false); setTxSaved(false); }, 1500);
    } finally {
      setTxSaving(false);
    }
  };

  const addPageFromFile = async (file: File) => {
    try {
      const compressed = await compressImageToBase64(file, 1600, 0.75, true);
      setPages((prev) => [...prev, { file, previewUrl: compressed.previewUrl, b64: compressed.b64, mime: compressed.mime }]);
    } catch { /* ignore */ }
  };

  const removePage = (idx: number) => setPages((prev) => prev.filter((_, i) => i !== idx));

  const handleMultiDone = async () => {
    if (pages.length === 0) return;
    setMultiProcessing(true); setUploadProgress("Загружаю файл в хранилище...");
    try {
      const firstName = pages[0].file.name;
      const totalSize = pages.reduce((s, p) => s + p.file.size, 0);
      const docName = pages.length > 1 ? `Накладная (${pages.length} стр.)` : firstName;
      let s3Url: string | undefined;
      if (pages[0]?.b64) {
        const uploadRes = await api.uploadDoc({ file_b64: pages[0].b64, file_name: `scan_${Date.now()}.jpg`, mime_type: "image/jpeg" });
        if (uploadRes.duplicate) {
          const dateStr = uploadRes.existing_date ? ` от ${uploadRes.existing_date.slice(0, 10)}` : "";
          alert(`⚠️ Этот файл уже загружен!\n\nДокумент: «${uploadRes.existing_name}»${dateStr}\n\nДубликат не сохранён.`);
          return;
        }
        s3Url = uploadRes.url;
      }
      setUploadProgress("Распознаю документ...");
      const res = await api.documents.create({ name: docName, size_label: `${(totalSize / 1024 / 1024).toFixed(1)} МБ`, status: "processing", ...(s3Url ? { s3_url: s3Url } : {}) });
      const combinedPreview = pages[0].previewUrl;
      if (combinedPreview) savePreview(res.document.id, combinedPreview);
      const newDoc: DocWithRecognition = { ...res.document, status: "processing", recognizing: true, previewUrl: combinedPreview, s3_url: s3Url };
      setDocs((prev) => [newDoc, ...prev]); setSelected(newDoc); setMobileView("detail"); setShowMultiModal(false);
      const images = pages.map((p) => ({ b64: p.b64, mime: p.mime }));
      setPages([]);
      await recognizeMultiPage(res.document.id, images, combinedPreview, docName);
    } finally {
      setMultiProcessing(false); setUploadProgress("");
    }
  };

  const selDone = selected?.status === "done" && !selected.recognizing;

  return (
    <div className="animate-fade-in flex flex-col gap-4">
      {/* Upload loader */}
      {uploading && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center gap-4 max-w-xs mx-4 shadow-xl">
            <div className="w-12 h-12 rounded-full border-4 border-gold/30 border-t-gold animate-spin" />
            <div className="text-sm font-medium text-center">{uploadProgress || "Загружаю файл..."}</div>
            <div className="text-xs text-muted-foreground text-center">Не закрывайте страницу</div>
          </div>
        </div>
      )}

      {/* Mobile buttons */}
      <div className="grid grid-cols-3 gap-2 lg:hidden">
        <button onClick={() => { setPages([]); setShowMultiModal(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex flex-col items-center justify-center gap-2 p-3 card-fin border-2 border-dashed border-gold/40 rounded-xl text-gold active:scale-95 transition-transform">
          <Icon name="Camera" size={22} />
          <span className="text-xs font-medium text-center">Сфотографировать</span>
        </button>
        <button onClick={() => queueInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 p-3 card-fin border-2 border-dashed border-border/60 rounded-xl text-muted-foreground active:scale-95 transition-transform">
          <Icon name="Upload" size={22} />
          <span className="text-xs font-medium text-center">Загрузить файл</span>
        </button>
        <button onClick={() => setShowManualModal(true)}
          className="flex flex-col items-center justify-center gap-2 p-3 card-fin border-2 border-dashed border-border/60 rounded-xl text-muted-foreground active:scale-95 transition-transform">
          <Icon name="FilePlus" size={22} />
          <span className="text-xs font-medium text-center">Без фото</span>
        </button>
        {/* Скрытый input для очереди — без multiple для iOS совместимости */}
        <input ref={queueInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx" className="hidden"
          onChange={(e) => {
            if (!e.target.files?.[0]) return;
            const newFiles = Array.from(e.target.files);
            setFileQueue((prev) => {
              const updated = [...prev, ...newFiles];
              setShowQueue(true);
              return updated;
            });
            e.target.value = "";
          }} />
        <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx" className="hidden"
          onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))} />
      </div>

      {/* Панель очереди файлов */}
      {showQueue && fileQueue.length > 0 && (
        <div className="lg:hidden card-fin p-3 border border-gold/30 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Файлы в очереди: {fileQueue.length}</span>
            <button onClick={() => { setFileQueue([]); setShowQueue(false); }}
              className="text-muted-foreground hover:text-foreground">
              <Icon name="X" size={16} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1 mb-3">
            {fileQueue.map((f, i) => (
              <span key={i} className="flex items-center gap-1 text-xs bg-secondary px-2 py-1 rounded-full">
                {f.name.length > 15 ? f.name.slice(0, 12) + "…" : f.name}
                <button onClick={() => setFileQueue((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-negative">
                  <Icon name="X" size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => queueInputRef.current?.click()}
              className="flex-1 py-2 border border-border rounded-lg text-xs text-muted-foreground hover:border-gold/40 hover:text-foreground flex items-center justify-center gap-1.5 transition-colors">
              <Icon name="Plus" size={13} /> Добавить ещё
            </button>
            <button
              onClick={async () => {
                const files = [...fileQueue];
                setFileQueue([]); setShowQueue(false);
                await addFiles(files);
              }}
              className="flex-1 py-2 bg-gold text-primary-foreground rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-transform">
              <Icon name="Zap" size={13} /> Обработать {fileQueue.length} файл{fileQueue.length === 1 ? "" : fileQueue.length < 5 ? "а" : "ов"}
            </button>
          </div>
        </div>
      )}

      {/* Hidden camera input */}
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
        {/* List panel */}
        <div className={mobileView === "detail" ? "hidden lg:contents" : "contents"}>
          <DocList
            docs={docs}
            loading={loading}
            selected={selected}
            dragging={dragging}
            inputRef={inputRef}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
            onFilesChange={addFiles}
            onAddManual={() => setShowManualModal(true)}
          />
        </div>

        {/* Detail panel */}
        <DocDetail
          selected={selected}
          mobileView={mobileView}
          selDone={selDone}
          editingCategory={editingCategory}
          savingCategory={savingCategory}
          newCatInline={newCatInline}
          addingCatInline={addingCatInline}
          customCategories={customCategories}
          reuploadRef={reuploadRef}
          onRecognizeAgain={recognizeAgain}
          onShare={shareDocument}
          onDownload={downloadDocument}
          onReupload={handleReupload}
          onDelete={handleDelete}
          onOpenCreateTx={openCreateTx}
          onFieldUpdate={handleFieldUpdate}
          onCategoryChange={handleCategoryChange}
          onSetEditingCategory={setEditingCategory}
          onSetAddingCatInline={setAddingCatInline}
          onSetNewCatInline={setNewCatInline}
          onSaveCustomCategory={saveCustomCategory}
          onSetCustomCategories={setCustomCategories}
          onCashlessToggle={handleCashlessToggle}
        />
      </div>

      {/* Modals */}
      <MergeDialog
        mergeDialog={mergeDialog}
        onClose={() => setMergeDialog(null)}
        onMultiPage={(images, nonImages) => { setMergeDialog(null); addFilesAsMultiPage(images.slice(0, 5)); nonImages.forEach((f) => processSingleFile(f)); }}
        onSeparate={(all) => { setMergeDialog(null); all.forEach((f) => processSingleFile(f)); }}
      />

      <DeleteDialog
        deleteConfirmId={deleteConfirmId}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />

      <TxModal
        show={showTxModal}
        selected={selected}
        txForm={txForm}
        txSaving={txSaving}
        txSaved={txSaved}
        customCategories={customCategories}
        showNewCat={showNewCat}
        newCatInput={newCatInput}
        onClose={() => setShowTxModal(false)}
        onSave={handleCreateTx}
        onFormChange={(patch) => setTxForm((f) => ({ ...f, ...patch }))}
        onShowNewCat={setShowNewCat}
        onNewCatInput={setNewCatInput}
        onSaveCustomCategory={saveCustomCategory}
        onSetCustomCategories={setCustomCategories}
      />

      <MultiModal
        show={showMultiModal}
        pages={pages}
        multiProcessing={multiProcessing}
        uploadProgress={uploadProgress}
        multiCameraRef={multiCameraRef}
        onClose={() => { setShowMultiModal(false); setPages([]); }}
        onRemovePage={removePage}
        onDone={handleMultiDone}
      />

      <ManualDocModal
        show={showManualModal}
        saving={manualSaving}
        customCategories={customCategories}
        onClose={() => setShowManualModal(false)}
        onSave={handleManualDoc}
      />
    </div>
  );
}