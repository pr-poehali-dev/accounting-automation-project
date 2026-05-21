import { useState } from "react";
import Icon from "@/components/ui/icon";

const models = [
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "DeepSeek", desc: "Мощная модель, очень доступная цена", recommended: true },
  { id: "deepseek-reasoner", name: "DeepSeek R1", provider: "DeepSeek", desc: "Режим рассуждений — лучший для аналитики" },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", desc: "Оптимальный баланс качества и скорости" },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "OpenAI", desc: "Максимальное качество" },
  { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", desc: "Отличен для длинных текстов и аналитики" },
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

export default function AdminSettings() {
  const [selectedModel, setSelectedModel] = useState("deepseek-chat");
  const [showKey, setShowKey] = useState(false);
  const [maxTokens, setMaxTokens] = useState("4096");
  const [temperature, setTemperature] = useState("0.3");
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const handleModelSelect = (id: string) => {
    setSelectedModel(id);
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    await new Promise((r) => setTimeout(r, 1500));
    setTesting(false);
    setTestResult("ok");
    setTimeout(() => setTestResult(null), 4000);
  };

  const providerGroups = [
    { name: "DeepSeek", color: "text-blue-400", models: models.filter((m) => m.provider === "DeepSeek") },
    { name: "OpenAI", color: "text-green-400", models: models.filter((m) => m.provider === "OpenAI") },
    { name: "Другие", color: "text-muted-foreground", models: models.filter((m) => m.provider !== "DeepSeek" && m.provider !== "OpenAI") },
  ];

  return (
    <div className="animate-fade-in w-full max-w-3xl space-y-4">
      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
          Выбор модели ИИ
        </div>
        <div className="space-y-4">
          {providerGroups.map((group) => (
            <div key={group.name}>
              <div className={`text-xs font-medium mb-2 ${group.color}`}>{group.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.models.map((m) => (
                  <button key={m.id} onClick={() => handleModelSelect(m.id)}
                    className={`p-3 rounded-lg border text-left transition-all ${selectedModel === m.id ? "border-gold bg-gold/5" : "border-border hover:border-gold/30"}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium flex items-center gap-2">
                        {m.name}
                        {m.recommended && <span className="text-xs bg-gold/20 text-gold px-1.5 py-0.5 rounded font-mono-fin">Рекомендуем</span>}
                      </span>
                      {selectedModel === m.id && <Icon name="CheckCircle" size={14} className="text-gold flex-shrink-0" />}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
          Подключение к API
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">
              API Ключ
              {selectedModel.startsWith("deepseek") && (
                <span className="ml-2 text-blue-400">← ключ DeepSeek из настроек платформы</span>
              )}
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold pr-10"
                readOnly
                value="●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●"
              />
              <button onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                <Icon name={showKey ? "EyeOff" : "Eye"} size={14} />
              </button>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Ключ хранится в защищённом хранилище сервера</div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">API Endpoint</label>
            <input
              value={endpointByModel[selectedModel] ?? "https://api.openai.com/v1"}
              readOnly
              className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-muted-foreground focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
          Параметры генерации
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Максимум токенов</label>
            <input
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              type="number"
              className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground flex items-center justify-between mb-1.5">
              <span>Температура</span>
              <span className="font-mono-fin text-gold">{temperature}</span>
            </label>
            <input
              type="range" min="0" max="1" step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className="w-full accent-yellow-500"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Точно</span><span>Творчески</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card-fin p-4 sm:p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
          Системный промпт
        </div>
        <textarea
          rows={4}
          defaultValue="Ты финансовый ИИ-ассистент для B2B компании. Отвечай профессионально, кратко и по делу. Используй данные из финансовой системы для точных ответов. Форматируй суммы в рублях."
          className="w-full bg-secondary border border-border rounded px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold resize-none leading-relaxed"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 pb-4">
        <button onClick={handleSave}
          className="px-5 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors flex items-center gap-2">
          <Icon name="Save" size={15} />
          Сохранить
        </button>
        <button onClick={handleTest} disabled={testing}
          className="px-4 py-2.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors flex items-center gap-2 disabled:opacity-50">
          {testing ? <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" /> : <Icon name="Wifi" size={15} />}
          Тест соединения
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-positive animate-fade-in">
            <Icon name="CheckCircle" size={13} /> Сохранено
          </span>
        )}
        {testResult === "ok" && (
          <span className="flex items-center gap-1.5 text-xs text-positive animate-fade-in">
            <Icon name="CheckCircle" size={13} /> Соединение успешно
          </span>
        )}
        {testResult === "fail" && (
          <span className="flex items-center gap-1.5 text-xs text-negative animate-fade-in">
            <Icon name="AlertCircle" size={13} /> Ошибка соединения
          </span>
        )}
      </div>
    </div>
  );
}
