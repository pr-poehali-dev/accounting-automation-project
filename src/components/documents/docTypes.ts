import type { DocRecord, RecognizeResult } from "@/lib/api";

export interface DocWithRecognition extends DocRecord {
  recognizing?: boolean;
  recognition?: RecognizeResult;
  recognitionError?: string;
  previewUrl?: string;
}

export interface PageItem {
  file: File;
  previewUrl: string;
  b64: string;
  mime: string;
}

export const DEFAULT_CATEGORIES = ["Закупка товара", "Услуги", "Аренда", "Зарплаты", "Оборудование", "Маркетинг", "Логистика", "Прочее"];
export const CUSTOM_CATEGORIES_KEY = "custom_categories_v1";

export function loadCustomCategories(): string[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) || "[]"); } catch { return []; }
}

export function saveCustomCategory(name: string) {
  const existing = loadCustomCategories();
  if (!existing.includes(name)) localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify([...existing, name]));
}

export function isImage(name: string) {
  return /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name);
}

export function isExcel(name: string) {
  return /\.(xlsx|xls)$/i.test(name);
}

export function isSupported(name: string) {
  return /\.(pdf|jpg|jpeg|png|webp|gif|bmp|xlsx|xls)$/i.test(name);
}

export function fileToBase64(file: File): Promise<string> {
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

export function compressImageToBase64(
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
          const imgData = ctx.getImageData(0, 0, width, height);
          const d = imgData.data;
          let min = 255, max = 0;
          const step = Math.max(1, Math.floor(d.length / 40000));
          for (let i = 0; i < d.length; i += 4 * step) {
            const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (y < min) min = y;
            if (y > max) max = y;
          }
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
          const blurCanvas = document.createElement("canvas");
          blurCanvas.width = width; blurCanvas.height = height;
          const bctx = blurCanvas.getContext("2d")!;
          bctx.filter = "blur(1.2px)";
          bctx.drawImage(canvas, 0, 0);
          ctx.globalCompositeOperation = "difference";
          ctx.drawImage(blurCanvas, 0, 0);
          ctx.globalCompositeOperation = "source-over";
          ctx.clearRect(0, 0, width, height);
          ctx.putImageData(imgData, 0, 0);
          const finalCanvas = document.createElement("canvas");
          finalCanvas.width = width; finalCanvas.height = height;
          const fctx = finalCanvas.getContext("2d")!;
          fctx.filter = "contrast(1.05) saturate(0.85) brightness(1.03)";
          fctx.drawImage(canvas, 0, 0);
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(finalCanvas, 0, 0);
        } catch { /* ignore */ }
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
