import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";

const CHAT_URL = "https://functions.poehali.dev/1700fcd4-35b3-4a49-8472-292f760d2f96";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
  error?: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const suggestions = [
  "Какова чистая прибыль за май?",
  "Топ-3 категории расходов?",
  "Сравни доходы апрель vs май",
  "Как снизить налоговую нагрузку?",
];

const getTime = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

const initialMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    text: "Добро пожаловать в ФинансПро ИИ-ассистент (DeepSeek). Могу анализировать финансы, объяснять данные и помогать с отчётами. Задайте вопрос или выберите подсказку ниже.",
    time: getTime(),
  },
];

function renderText(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}

export default function AiChat() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("deepseek-chat");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { id: Date.now(), role: "user", text, time: getTime() };
    const newHistory: ChatMessage[] = [...history, { role: "user", content: text }];

    setMessages((prev) => [...prev, userMsg]);
    setHistory(newHistory);
    setInput("");
    setLoading(true);

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory, model }),
      });

      const data = await resp.json();

      if (!resp.ok || data.error) {
        const errText = data.error || `Ошибка ${resp.status}`;
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, role: "assistant", text: errText, time: getTime(), error: true },
        ]);
      } else {
        const reply = data.reply as string;
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, role: "assistant", text: reply, time: getTime() },
        ]);
        setHistory((h) => [...h, { role: "assistant", content: reply }]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: "Не удалось подключиться к ИИ. Проверьте интернет-соединение.",
          time: getTime(),
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handleReset = () => {
    setMessages(initialMessages);
    setHistory([]);
    setInput("");
  };

  return (
    <div className="animate-fade-in card-fin flex flex-col" style={{ height: "calc(100dvh - 112px)", minHeight: "400px" }}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
            <Icon name="Sparkles" size={16} className="text-gold" />
          </div>
          <div>
            <div className="text-sm font-medium">ФинансПро ИИ</div>
            <div className="text-xs text-positive flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-positive inline-block" />
              DeepSeek
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs bg-secondary border border-border rounded px-2 py-1 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold"
          >
            <option value="deepseek-chat">DeepSeek V3</option>
            <option value="deepseek-reasoner">DeepSeek R1</option>
          </select>
          <button
            onClick={handleReset}
            title="Новый диалог"
            className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="RotateCcw" size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 sm:px-5">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 sm:gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${msg.role === "assistant" ? "bg-gold/20" : "bg-secondary"}`}>
              {msg.role === "assistant"
                ? <Icon name="Sparkles" size={13} className="text-gold" />
                : <Icon name="User" size={13} className="text-muted-foreground" />}
            </div>
            <div className={`max-w-[85%] sm:max-w-[75%] flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl text-sm leading-relaxed break-words ${
                  msg.error
                    ? "bg-red-900/20 text-negative border border-red-900/30 rounded-tl-none"
                    : msg.role === "assistant"
                    ? "bg-secondary text-foreground rounded-tl-none"
                    : "bg-gold text-primary-foreground rounded-tr-none"
                }`}
                dangerouslySetInnerHTML={{ __html: renderText(msg.text) }}
              />
              <span className="text-xs text-muted-foreground px-1">{msg.time}</span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2 sm:gap-3">
            <div className="w-7 h-7 rounded-full bg-gold/20 flex items-center justify-center flex-shrink-0">
              <Icon name="Sparkles" size={13} className="text-gold" />
            </div>
            <div className="bg-secondary rounded-xl rounded-tl-none px-4 py-3 flex gap-1.5 items-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 sm:p-4 border-t border-border flex-shrink-0">
        <div className="flex gap-1.5 mb-3 flex-wrap">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={loading}
              className="text-xs px-2.5 py-1.5 rounded-full border border-border text-muted-foreground hover:border-gold/40 hover:text-foreground transition-all disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Введите сообщение... (Enter — отправить)"
            rows={1}
            className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold resize-none"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-lg bg-gold text-primary-foreground flex items-center justify-center hover:bg-yellow-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Icon name="Send" size={15} />
          </button>
        </div>
        <div className="text-xs text-muted-foreground mt-2 text-center hidden sm:block">
          Enter — отправить &nbsp;•&nbsp; Shift+Enter — перенос строки
        </div>
      </div>
    </div>
  );
}
