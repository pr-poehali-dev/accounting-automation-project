import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { api, type AiSettings } from "@/lib/api";

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
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    api.aiSettings.get()
      .then((res) => setSettings(res.settings))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError("");
    try {
      const res = await api.aiSettings.update(settings);
      setSettings(res.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
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
                          {m.recommended && <span className="text-xs bg-gold/20 text-gold px-1.5 py-0.5 rounded font-mono-fin">Рекомендуем</span>}
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

      {/* API connection */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">Подключение к API</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">API Ключ</label>
            <div className="relative">
              <input type="password" value="●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●" readOnly
                className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none" />
            </div>
            <div className="text-xs text-muted-foreground mt-1">Ключ хранится в защищённом хранилище сервера</div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">API Endpoint</label>
            <input value={endpointByModel[settings.selected_model] ?? "https://api.openai.com/v1"} readOnly
              className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-muted-foreground focus:outline-none" />
          </div>
        </div>
      </div>

      {/* Generation params */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">Параметры генерации</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Максимум токенов</label>
            <input type="number" value={settings.max_tokens}
              onChange={(e) => setSettings((s) => ({ ...s, max_tokens: Number(e.target.value) }))}
              className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground flex items-center justify-between mb-1.5">
              <span>Температура</span>
              <span className="font-mono-fin text-gold">{settings.temperature}</span>
            </label>
            <input type="range" min="0" max="1" step="0.1" value={settings.temperature}
              onChange={(e) => setSettings((s) => ({ ...s, temperature: Number(e.target.value) }))}
              className="w-full accent-yellow-500" />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Точно</span><span>Творчески</span>
            </div>
          </div>
        </div>
      </div>

      {/* System prompt */}
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">Системный промпт</div>
        <textarea rows={4} value={settings.system_prompt}
          onChange={(e) => setSettings((s) => ({ ...s, system_prompt: e.target.value }))}
          className="w-full bg-secondary border border-border rounded px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold resize-none leading-relaxed" />
      </div>

      <div className="flex flex-wrap items-center gap-3 pb-4">
        <button onClick={handleSave} disabled={saving}
          className="px-5 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors flex items-center gap-2 disabled:opacity-50">
          {saving ? <div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" /> : <Icon name="Save" size={15} />}
          Сохранить настройки
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-positive animate-fade-in">
            <Icon name="CheckCircle" size={13} /> Сохранено
          </span>
        )}
        {saveError && (
          <span className="flex items-center gap-1.5 text-xs text-negative animate-fade-in">
            <Icon name="AlertCircle" size={13} /> {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
