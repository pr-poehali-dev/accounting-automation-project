import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api, type AiSettings, type S3Settings } from "@/lib/api";

const models = [
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "DeepSeek", desc: "Мощная модель, очень доступная цена", recommended: true },
  { id: "deepseek-reasoner", name: "DeepSeek R1", provider: "DeepSeek", desc: "Режим рассуждений — лучший для аналитики" },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", desc: "Оптимальный баланс качества и скорости" },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "OpenAI", desc: "Максимальное качество" },
  { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", desc: "Отличен для аналитики и длинных текстов" },
  { id: "gemini-pro", name: "Gemini 1.5 Pro", provider: "Google", desc: "Большой контекст, мультимодальность" },
];

const endpointByModel: Record<string, string> = {
  "deepseek-chat": "https://api.deepseek.com/v1",
  "deepseek-reasoner": "https://api.deepseek.com/v1",
  "gpt-4o": "https://api.openai.com/v1",
  "gpt-4-turbo": "https://api.openai.com/v1",
  "claude-3-5-sonnet": "https://api.anthropic.com/v1",
  "gemini-pro": "https://generativelanguage.googleapis.com/v1beta",
};

const providerGroups = [
  { name: "DeepSeek", color: "text-blue-400", ids: ["deepseek-chat", "deepseek-reasoner"] },
  { name: "OpenAI", color: "text-green-400", ids: ["gpt-4o", "gpt-4-turbo"] },
  { name: "Другие", color: "text-muted-foreground", ids: ["claude-3-5-sonnet", "gemini-pro"] },
];

export default function AdminSettings() {
  const [settings, setSettings] = useState<AiSettings>({
    selected_model: "deepseek-chat",
    max_tokens: 4096,
    temperature: 0.3,
    system_prompt: "Ты финансовый ИИ-ассистент для B2B компании. Отвечай профессионально, кратко и по делу. Форматируй суммы в рублях.",
    api_key_set: false,
    api_key_masked: "",
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [yandexKeyInput, setYandexKeyInput] = useState("");
  const [yandexFolderInput, setYandexFolderInput] = useState("");
  const [showYandexKey, setShowYandexKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // S3
  const [s3, setS3] = useState<S3Settings>({ bucket_name: "", endpoint_url: "https://s3.regru.cloud", access_key: "", secret_key_masked: "" });
  const [s3SecretInput, setS3SecretInput] = useState("");
  const [showS3Secret, setShowS3Secret] = useState(false);
  const [s3Saving, setS3Saving] = useState(false);
  const [s3Saved, setS3Saved] = useState(false);
  const [s3SaveError, setS3SaveError] = useState("");
  const [s3Testing, setS3Testing] = useState(false);
  const [s3TestResult, setS3TestResult] = useState<{ ok: boolean; error?: string; message?: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.aiSettings.get(),
      api.s3Settings.get(),
    ]).then(([aiRes, s3Res]) => {
      setSettings(aiRes.settings);
      setS3(s3Res.settings);
    }).finally(() => setLoading(false));
  }, []);

  const handleS3Save = async () => {
    setS3Saving(true); setS3Saved(false); setS3SaveError(""); setS3TestResult(null);
    try {
      const payload: Parameters<typeof api.s3Settings.update>[0] = {
        bucket_name: s3.bucket_name,
        endpoint_url: s3.endpoint_url,
        access_key: s3.access_key,
      };
      if (s3SecretInput.trim()) payload.secret_key = s3SecretInput.trim();
      const res = await api.s3Settings.update(payload);
      setS3(res.settings);
      if (s3SecretInput.trim()) setS3SecretInput("");
      setS3Saved(true);
      setTimeout(() => setS3Saved(false), 3000);
    } catch (e) {
      setS3SaveError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setS3Saving(false);
    }
  };

  const handleS3Test = async () => {
    if (s3SecretInput.trim()) await handleS3Save();
    setS3Testing(true); setS3TestResult(null);
    try {
      const res = await api.s3Settings.test();
      setS3TestResult(res);
    } catch (e) {
      setS3TestResult({ ok: false, error: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setS3Testing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError("");
    setTestResult(null);
    try {
      const payload: Parameters<typeof api.aiSettings.update>[0] = {
        selected_model: settings.selected_model,
        max_tokens: settings.max_tokens,
        temperature: settings.temperature,
        system_prompt: settings.system_prompt,
      };
      if (apiKeyInput.trim()) {
        payload.api_key = apiKeyInput.trim();
      }
      if (geminiKeyInput.trim()) {
        payload.gemini_api_key = geminiKeyInput.trim();
      }
      if (yandexKeyInput.trim()) {
        payload.yandex_api_key = yandexKeyInput.trim();
      }
      if (yandexFolderInput.trim()) {
        payload.yandex_folder_id = yandexFolderInput.trim();
      }
      const res = await api.aiSettings.update(payload);
      setSettings(res.settings);
      if (apiKeyInput.trim()) setApiKeyInput("");
      if (geminiKeyInput.trim()) setGeminiKeyInput("");
      if (yandexKeyInput.trim()) setYandexKeyInput("");
      if (yandexFolderInput.trim()) setYandexFolderInput("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    // Если есть несохранённый ключ — сначала сохраним
    if (apiKeyInput.trim()) {
      await handleSave();
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.aiSettings.testConnection();
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "Ошибка подключения" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in max-w-3xl space-y-4">
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="card-fin p-5 space-y-3 animate-pulse">
            <div className="h-4 bg-secondary rounded w-1/4" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-16 bg-secondary rounded" />
              <div className="h-16 bg-secondary rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const currentModel = models.find((m) => m.id === settings.selected_model);

  return (
    <div className="animate-fade-in w-full max-w-3xl space-y-4">

      {/* Model selection */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">Выбор модели ИИ</div>
        <div className="space-y-4">
          {providerGroups.map((group) => (
            <div key={group.name}>
              <div className={`text-xs font-medium mb-2 ${group.color}`}>{group.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.ids.map((id) => {
                  const m = models.find((x) => x.id === id)!;
                  return (
                    <button key={id} onClick={() => setSettings((s) => ({ ...s, selected_model: id }))}
                      className={`p-3 rounded-lg border text-left transition-all ${settings.selected_model === id ? "border-gold bg-gold/5" : "border-border hover:border-gold/30"}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium flex items-center gap-2">
                          {m.name}
                          {m.recommended && (
                            <span className="text-xs bg-gold/20 text-gold px-1.5 py-0.5 rounded font-mono-fin">Рекомендуем</span>
                          )}
                        </span>
                        {settings.selected_model === id && <Icon name="CheckCircle" size={14} className="text-gold flex-shrink-0" />}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Key + Test */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">Подключение к API</div>
        <div className="space-y-3">

          {/* API Key field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-muted-foreground">
                API Ключ
                {currentModel && (
                  <span className="ml-2 text-muted-foreground/60">для {currentModel.provider}</span>
                )}
              </label>
              {settings.api_key_set && !apiKeyInput && (
                <span className="flex items-center gap-1 text-xs text-positive">
                  <Icon name="CheckCircle" size={11} /> Ключ сохранён
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={
                  settings.api_key_masked
                    ? settings.api_key_masked
                    : "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                }
                className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-gold pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Icon name={showKey ? "EyeOff" : "Eye"} size={15} />
              </button>
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">
              {settings.api_key_set && !apiKeyInput
                ? "Введите новый ключ чтобы заменить сохранённый"
                : "Ключ сохраняется в защищённом хранилище сервера, не в браузере"}
            </div>
          </div>

          {/* Endpoint (read-only info) */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">API Endpoint</label>
            <input
              value={endpointByModel[settings.selected_model] ?? "https://api.openai.com/v1"}
              readOnly
              className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-muted-foreground focus:outline-none"
            />
          </div>

          {/* Gemini API Key — для распознавания фото */}
          <div className="rounded-lg border border-blue-900/30 bg-blue-900/10 p-3.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <Icon name="ScanLine" size={15} className="text-blue-400 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-blue-300">Google Gemini — распознавание фото</div>
                <div className="text-xs text-muted-foreground">Бесплатно. Нужен для чтения накладных и чеков</div>
              </div>
              {settings.gemini_key_set && (
                <span className="ml-auto flex items-center gap-1 text-xs text-positive whitespace-nowrap"><Icon name="CheckCircle" size={11} />Ключ есть</span>
              )}
            </div>
            <div className="relative">
              <input
                type={showGeminiKey ? "text" : "password"}
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                placeholder={settings.gemini_key_masked || "AIzaSy..."}
                className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
              />
              <button type="button" onClick={() => setShowGeminiKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <Icon name={showGeminiKey ? "EyeOff" : "Eye"} size={15} />
              </button>
            </div>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              <Icon name="ExternalLink" size={12} /> Получить бесплатный ключ на aistudio.google.com
            </a>
          </div>

          {/* Yandex Vision — распознавание фото (приоритетный) */}
          <div className="rounded-lg border border-red-900/30 bg-red-900/10 p-3.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <Icon name="ScanEye" size={15} className="text-red-400 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-red-300">Яндекс Vision — распознавание документов</div>
                <div className="text-xs text-muted-foreground">Приоритетный провайдер. Отлично читает русский текст</div>
              </div>
              {settings.yandex_key_set && (
                <span className="ml-auto flex items-center gap-1 text-xs text-positive whitespace-nowrap"><Icon name="CheckCircle" size={11} />Ключ есть</span>
              )}
            </div>
            <div className="relative">
              <input
                type={showYandexKey ? "text" : "password"}
                value={yandexKeyInput}
                onChange={(e) => setYandexKeyInput(e.target.value)}
                placeholder={settings.yandex_key_masked || "AQVN..."}
                className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-red-500 pr-10"
              />
              <button type="button" onClick={() => setShowYandexKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <Icon name={showYandexKey ? "EyeOff" : "Eye"} size={15} />
              </button>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Folder ID каталога Яндекс Облако
                {settings.yandex_folder_set && !yandexFolderInput && (
                  <span className="ml-2 text-positive">✓ сохранён</span>
                )}
              </label>
              <input
                type="text"
                value={yandexFolderInput}
                onChange={(e) => setYandexFolderInput(e.target.value)}
                placeholder={settings.yandex_folder_masked || "b1g..."}
                className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
            <a href="https://console.yandex.cloud" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors">
              <Icon name="ExternalLink" size={12} /> Открыть Яндекс Облако — скопировать ключ и Folder ID
            </a>
          </div>

          {/* Test connection result */}
          {testResult && (
            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm animate-fade-in ${
              testResult.ok
                ? "bg-green-900/20 border-green-900/30 text-positive"
                : "bg-red-900/20 border-red-900/30 text-negative"
            }`}>
              <Icon name={testResult.ok ? "CheckCircle" : "AlertCircle"} size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                {testResult.ok
                  ? <>Подключение успешно. Модель <strong>{currentModel?.name}</strong> отвечает.</>
                  : <>{testResult.error || "Не удалось подключиться"}</>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Generation params */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">Параметры генерации</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Максимум токенов</label>
            <input
              type="number"
              value={settings.max_tokens}
              onChange={(e) => setSettings((s) => ({ ...s, max_tokens: Number(e.target.value) }))}
              className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground flex items-center justify-between mb-1.5">
              <span>Температура</span>
              <span className="font-mono-fin text-gold">{settings.temperature}</span>
            </label>
            <input
              type="range" min="0" max="1" step="0.1"
              value={settings.temperature}
              onChange={(e) => setSettings((s) => ({ ...s, temperature: Number(e.target.value) }))}
              className="w-full accent-yellow-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Точно</span><span>Творчески</span>
            </div>
          </div>
        </div>
      </div>

      {/* System prompt */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">Системный промпт</div>
        <textarea
          rows={4}
          value={settings.system_prompt}
          onChange={(e) => setSettings((s) => ({ ...s, system_prompt: e.target.value }))}
          className="w-full bg-secondary border border-border rounded px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold resize-none leading-relaxed"
        />
      </div>

      {/* Action buttons AI */}
      <div className="flex flex-wrap items-center gap-3 pb-2">
        <button onClick={handleSave} disabled={saving}
          className="px-5 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors flex items-center gap-2 disabled:opacity-50">
          {saving ? <div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" /> : <Icon name="Save" size={15} />}
          Сохранить ИИ
        </button>
        <button onClick={handleTest} disabled={testing || saving}
          className="px-4 py-2.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors flex items-center gap-2 disabled:opacity-50">
          {testing ? <div className="w-4 h-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" /> : <Icon name="Wifi" size={15} />}
          Проверить связь с ИИ
        </button>
        {saved && <span className="flex items-center gap-1.5 text-xs text-positive animate-fade-in"><Icon name="CheckCircle" size={13} /> Сохранено</span>}
        {saveError && <span className="flex items-center gap-1.5 text-xs text-negative animate-fade-in"><Icon name="AlertCircle" size={13} /> {saveError}</span>}
      </div>

      {/* ═══════════ БЛОК S3 ═══════════ */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1 gold-line pl-3">Хранилище Reg.ru S3</div>
        <div className="text-xs text-muted-foreground mb-4 pl-3">Для сохранения фото документов и формирования PDF-отчётов</div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Имя бакета (Bucket Name)</label>
              <input value={s3.bucket_name} onChange={(e) => setS3((s) => ({ ...s, bucket_name: e.target.value }))}
                placeholder="strimbazar"
                className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Endpoint URL</label>
              <input value={s3.endpoint_url} onChange={(e) => setS3((s) => ({ ...s, endpoint_url: e.target.value }))}
                placeholder="https://s3.regru.cloud"
                className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Access Key ID</label>
            <input value={s3.access_key} onChange={(e) => setS3((s) => ({ ...s, access_key: e.target.value }))}
              placeholder="Открытый ключ из личного кабинета Рег.ру"
              className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-muted-foreground">Secret Access Key</label>
              {s3.secret_key_masked && !s3SecretInput && (
                <span className="flex items-center gap-1 text-xs text-positive"><Icon name="CheckCircle" size={11} /> Ключ сохранён</span>
              )}
            </div>
            <div className="relative">
              <input type={showS3Secret ? "text" : "password"} value={s3SecretInput}
                onChange={(e) => setS3SecretInput(e.target.value)}
                placeholder={s3.secret_key_masked || "Секретный ключ (генерируется один раз)"}
                className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm font-mono-fin text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-gold pr-10" />
              <button type="button" onClick={() => setShowS3Secret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                <Icon name={showS3Secret ? "EyeOff" : "Eye"} size={15} />
              </button>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Ключ хранится в защищённом хранилище сервера</div>
          </div>

          {s3TestResult && (
            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm animate-fade-in ${s3TestResult.ok ? "bg-green-900/20 border-green-900/30 text-positive" : "bg-red-900/20 border-red-900/30 text-negative"}`}>
              <Icon name={s3TestResult.ok ? "CheckCircle" : "AlertCircle"} size={16} className="flex-shrink-0 mt-0.5" />
              <div>{s3TestResult.ok ? (s3TestResult.message || "Доступ к Рег.облаку настроен успешно!") : (s3TestResult.error || "Ошибка подключения")}</div>
            </div>
          )}
        </div>
      </div>

      {/* S3 action buttons */}
      <div className="flex flex-wrap items-center gap-3 pb-4">
        <button onClick={handleS3Save} disabled={s3Saving}
          className="px-5 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors flex items-center gap-2 disabled:opacity-50">
          {s3Saving ? <div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" /> : <Icon name="Save" size={15} />}
          Сохранить S3
        </button>
        <button onClick={handleS3Test} disabled={s3Testing || s3Saving}
          className="px-4 py-2.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors flex items-center gap-2 disabled:opacity-50">
          {s3Testing ? <div className="w-4 h-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" /> : <Icon name="HardDrive" size={15} />}
          Проверить связь S3
        </button>
        {s3Saved && <span className="flex items-center gap-1.5 text-xs text-positive animate-fade-in"><Icon name="CheckCircle" size={13} /> Сохранено</span>}
        {s3SaveError && <span className="flex items-center gap-1.5 text-xs text-negative animate-fade-in"><Icon name="AlertCircle" size={13} /> {s3SaveError}</span>}
      </div>
    </div>
  );
}