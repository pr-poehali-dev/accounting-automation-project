import { useState } from "react";
import Icon from "@/components/ui/icon";

const models = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", desc: "Оптимальный баланс качества и скорости" },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "OpenAI", desc: "Максимальное качество, выше стоимость" },
  { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", desc: "Отличен для аналитики и длинных текстов" },
  { id: "gemini-pro", name: "Gemini 1.5 Pro", provider: "Google", desc: "Большой контекст, мультимодальность" },
];

export default function AdminSettings() {
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("sk-••••••••••••••••••••••••••••••");
  const [showKey, setShowKey] = useState(false);
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1");
  const [maxTokens, setMaxTokens] = useState("4096");
  const [temperature, setTemperature] = useState("0.3");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="animate-fade-in max-w-3xl space-y-5">
      <div className="card-fin p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
          Подключение к ИИ
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">API Ключ</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold pr-10"
              />
              <button onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                <Icon name={showKey ? "EyeOff" : "Eye"} size={14} />
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">API Endpoint</label>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-4 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
        </div>
      </div>

      <div className="card-fin p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
          Выбор модели
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {models.map((m) => (
            <button key={m.id} onClick={() => setSelectedModel(m.id)}
              className={`p-4 rounded-lg border text-left transition-all ${selectedModel === m.id ? "border-gold bg-gold/5" : "border-border hover:border-gold/30"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{m.name}</span>
                {selectedModel === m.id && <Icon name="CheckCircle" size={14} className="text-gold" />}
              </div>
              <div className="text-xs text-muted-foreground">{m.provider} • {m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card-fin p-5">
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
              <span>Температура (creativity)</span>
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

      <div className="card-fin p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-4 gold-line pl-3">
          Системный промпт
        </div>
        <textarea
          rows={4}
          defaultValue="Ты финансовый ИИ-ассистент для B2B компании. Отвечай профессионально, кратко и по делу. Используй данные из финансовой системы для точных ответов. Форматируй суммы в рублях."
          className="w-full bg-secondary border border-border rounded px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold resize-none leading-relaxed"
        />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave}
          className="px-6 py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors flex items-center gap-2">
          <Icon name="Save" size={15} />
          Сохранить настройки
        </button>
        <button className="px-4 py-2.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground hover:border-gold/40 transition-colors flex items-center gap-2">
          <Icon name="Wifi" size={15} />
          Тест подключения
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs text-positive animate-fade-in">
            <Icon name="CheckCircle" size={13} /> Сохранено
          </span>
        )}
      </div>
    </div>
  );
}
