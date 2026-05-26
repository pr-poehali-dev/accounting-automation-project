const URLS = {
  imgProxy: "https://functions.poehali.dev/175171fe-6d38-4594-af4a-511eff3025ef",
  transactions: "https://functions.poehali.dev/3105b014-e11e-42e7-b435-176f087cf6e1",
  documents: "https://functions.poehali.dev/ab114954-abef-4fbd-aa0f-6200ccdf9984",
  taxReports: "https://functions.poehali.dev/d6031486-b133-49f5-ab9c-8dae0492a797",
  aiSettings: "https://functions.poehali.dev/2d22aebf-09ca-46d6-98b1-a36a7556d511",
  aiChat: "https://functions.poehali.dev/1700fcd4-35b3-4a49-8472-292f760d2f96",
  recognizeDoc: "https://functions.poehali.dev/912d2561-eabf-42bf-9a5f-29747a113c4e",
  s3Settings: "https://functions.poehali.dev/994a3fe5-ea96-4bca-bad7-09a990b48212",
  uploadDoc: "https://functions.poehali.dev/cc362dea-3988-4a28-a94e-166b527ac26c",
  generatePdf: "https://functions.poehali.dev/fff58902-afa3-4eb6-8403-6975c2c5ce0b",
  docsPdf: "https://functions.poehali.dev/cd1cab49-82a0-450c-9939-2afd35536b4b",
};

/** Оборачивает URL из Яндекс S3 в прокси для обхода CORS */
export function proxyImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.includes("storage.yandexcloud.net")) {
    return `${URLS.imgProxy}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

// ─── Transactions ───────────────────────────────────────────
export interface Transaction {
  id: number;
  date: string;
  description: string;
  category: string;
  amount: number;
  status: string;
  is_taxable?: boolean;
  is_cashless?: boolean;
  document_id?: number | null;
  created_at?: string;
}

export interface DashboardSummary {
  balance: number;
  income_month: number;
  expense_month: number;
  income_year: number;
  expense_year: number;
  profit_month: number;
  chart: { month: string; доход: number; расход: number }[];
  categories: { name: string; сумма: number }[];
}

export const api = {
  transactions: {
    summary: (year?: number) =>
      request<DashboardSummary>(`${URLS.transactions}?action=summary${year ? `&year=${year}` : ""}`),

    list: (params?: { search?: string; category?: string; date_from?: string; date_to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set("search", params.search);
      if (params?.category && params.category !== "Все") qs.set("category", params.category);
      if (params?.date_from) qs.set("date_from", params.date_from);
      if (params?.date_to) qs.set("date_to", params.date_to);
      const q = qs.toString();
      return request<{ transactions: Transaction[]; total: number }>(
        `${URLS.transactions}${q ? "?" + q : ""}`
      );
    },

    create: (data: Omit<Transaction, "id" | "created_at">) =>
      request<{ transaction: Transaction }>(URLS.transactions, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    update: (id: number, data: Partial<Transaction>) =>
      request<{ transaction: Transaction }>(`${URLS.transactions}?id=${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`${URLS.transactions}?id=${id}`, { method: "DELETE" }),
  },

  // ─── Documents ──────────────────────────────────────────
  documents: {
    list: () =>
      request<{ documents: DocRecord[] }>(URLS.documents),

    create: (data: Partial<DocRecord>) =>
      request<{ document: DocRecord }>(URLS.documents, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    update: (id: number, data: Partial<DocRecord>) =>
      request<{ document: DocRecord }>(`${URLS.documents}?id=${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`${URLS.documents}?id=${id}`, { method: "DELETE" }),
  },

  // ─── Tax Reports ────────────────────────────────────────
  taxReports: {
    list: () =>
      request<{ reports: TaxReport[] }>(URLS.taxReports),

    summary: (params?: { date_from?: string; date_to?: string }) => {
      const qs = new URLSearchParams({ action: "summary" });
      if (params?.date_from) qs.set("date_from", params.date_from);
      if (params?.date_to) qs.set("date_to", params.date_to);
      return request<{ income: number; expense: number; expense_cashless: number; tax_base: number; vat: number }>(
        `${URLS.taxReports}?${qs.toString()}`
      );
    },

    create: (data: Partial<TaxReport>) =>
      request<{ report: TaxReport }>(URLS.taxReports, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`${URLS.taxReports}?id=${id}`, { method: "DELETE" }),
  },

  // ─── AI Settings ────────────────────────────────────────
  aiSettings: {
    get: () =>
      request<{ settings: AiSettings }>(URLS.aiSettings),

    update: (data: Partial<AiSettings> & { api_key?: string; gemini_api_key?: string; yandex_api_key?: string; yandex_folder_id?: string; proxyapi_key?: string; vision_provider?: string }) =>
      request<{ settings: AiSettings }>(URLS.aiSettings, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    testConnection: () =>
      request<{
        ok: boolean;
        error?: string;
        ai_model?: string;
        ai?: { ok: boolean; error?: string };
        vision_provider?: string;
        vision?: { ok: boolean | null; error?: string };
        yandex?: { ok: boolean | null; error?: string };
      }>(
        `${URLS.aiSettings}?action=test`
      ),
  },

  // ─── AI Chat ────────────────────────────────────────────
  chat: {
    send: (messages: { role: string; content: string }[], model = "deepseek-chat") =>
      request<{ reply: string; model: string }>(URLS.aiChat, {
        method: "POST",
        body: JSON.stringify({ messages, model }),
      }),
  },

  // ─── Recognize document ─────────────────────────────────
  recognizeDoc: (params: {
    image_b64?: string; mime_type?: string; file_name?: string;
    doc_id?: number; auto_create_tx?: boolean;
    images?: { b64: string; mime: string }[];
    excel_b64?: string;
    image_url?: string;
  }) =>
    request<RecognizeResult>(URLS.recognizeDoc, {
      method: "POST",
      body: JSON.stringify(params),
    }),


  generatePdf: (params: { date_from?: string; date_to?: string; taxable_only?: boolean; vat_rate?: string; mode?: "report" | "docs" }) => {
    const qs = new URLSearchParams();
    if (params.date_from) qs.set("date_from", params.date_from);
    if (params.date_to) qs.set("date_to", params.date_to);
    qs.set("taxable_only", params.taxable_only !== false ? "1" : "0");
    if (params.vat_rate !== undefined) qs.set("vat_rate", params.vat_rate);
    if (params.mode) qs.set("mode", params.mode);
    return request<{ url: string; filename: string }>(`${URLS.generatePdf}?${qs.toString()}`);
  },

  // ─── S3 Settings ────────────────────────────────────────
  s3Settings: {
    get: () => request<{ settings: S3Settings }>(URLS.s3Settings),
    update: (data: Partial<S3Settings> & { secret_key?: string }) =>
      request<{ ok: boolean; settings: S3Settings }>(URLS.s3Settings, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    test: () => request<{ ok: boolean; error?: string; message?: string }>(`${URLS.s3Settings}?action=test`),
  },

  // ─── Docs PDF (фото документов) ─────────────────────────
  docsPdf: async (ids?: number[]): Promise<{ ok: boolean; url?: string; filename?: string; count?: number; error?: string }> => {
    const qs = ids && ids.length ? `?ids=${ids.join(",")}` : "";
    return request<{ ok: boolean; url?: string; filename?: string; count?: number; error?: string }>(`${URLS.docsPdf}${qs}`);
  },

  // ─── Fix S3 ACL (public-read for all docs) ──────────────
  fixS3Acl: (): Promise<{ ok: boolean; fixed: number; errors_count: number; errors: { id: number; key: string; error: string }[] }> =>
    request<{ ok: boolean; fixed: number; errors_count: number; errors: { id: number; key: string; error: string }[] }>("https://functions.poehali.dev/9103f50f-35bf-436a-805f-a852b1f78e57", { method: "POST" }),

  // ─── Categories (статьи затрат) ─────────────────────────
  categories: {
    list: () => request<{ categories: { name: string; is_default: boolean }[] }>("https://functions.poehali.dev/c2ced8af-0c23-4b87-8705-185ef89e243e"),
    add: (name: string) => request<{ ok: boolean; name: string }>("https://functions.poehali.dev/c2ced8af-0c23-4b87-8705-185ef89e243e", { method: "POST", body: JSON.stringify({ name }) }),
    remove: (name: string) => request<{ ok: boolean }>(`https://functions.poehali.dev/c2ced8af-0c23-4b87-8705-185ef89e243e?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
  },

  // ─── Upload document to S3 ──────────────────────────────
  uploadDoc: async (params: { file_b64: string; file_name: string; mime_type: string; doc_id?: number }): Promise<{ ok: boolean; url: string; key: string; duplicate?: boolean; existing_name?: string; existing_date?: string; existing_id?: number }> => {
    const res = await fetch(URLS.uploadDoc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (res.status === 409) return { ok: false, url: "", key: "", ...data };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
};

// Types
export interface DocRecord {
  id: number;
  name: string;
  size_label: string | null;
  file_key: string | null;
  status: "processing" | "done" | "error";
  rec_type: string | null;
  rec_amount: string | null;
  rec_date: string | null;
  rec_counterparty: string | null;
  rec_inn: string | null;
  created_at: string;
  s3_url?: string | null;
  transaction_id?: number | null;
  rec_category?: string | null;
  is_cashless?: boolean;
}

export interface TaxReport {
  id: number;
  name: string;
  period: string;
  report_type: string;
  status: string;
  size_label: string | null;
  created_at: string;
}

export interface AiSettings {
  selected_model: string;
  max_tokens: number;
  temperature: number;
  system_prompt: string;
  api_key_set?: boolean;
  api_key_masked?: string;
  gemini_key_set?: boolean;
  gemini_key_masked?: string;
  yandex_key_set?: boolean;
  yandex_key_masked?: string;
  yandex_folder_set?: boolean;
  yandex_folder_masked?: string;
  proxyapi_key_set?: boolean;
  proxyapi_key_masked?: string;
  vision_provider?: string;
  updated_at?: string;
}

export interface S3Settings {
  bucket_name: string;
  endpoint_url: string;
  access_key: string;
  secret_key_masked?: string;
  configured?: boolean;
  use_yandex?: boolean;
}

export interface RecognizeResult {
  doc_type: string;
  counterparty: string | null;
  inn: string | null;
  date: string | null;
  amount: number | null;
  amount_str: string | null;
  description: string | null;
  category: string;
  type?: "expense" | "income";
  vision_failed?: boolean;
  transaction_id?: number | null;
  date_found?: boolean;
  error?: string;
  duplicate?: boolean;
  warning?: string;
  existing_name?: string;
  existing_id?: number;
}

export const fmt = (n: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);