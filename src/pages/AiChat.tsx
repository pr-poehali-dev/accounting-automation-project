import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
}

const suggestions = [
  "Какова чистая прибыль за май?",
  "Создай расходную операцию на 50 000 ₽",
  "Покажи топ-3 категории расходов",
  "Сравни доходы апрель vs май",
];

const mockReplies: Record<string, string> = {
  default: "Анализирую ваши финансовые данные... За май 2026 общий баланс составляет **₽ 47 382 500**. Доходы выросли на 23.1% по сравнению с апрелем. Чем ещё могу помочь?",
};

const getTime = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

const initialMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    text: "Добро пожаловать в ФинансПро ИИ-ассистент. Я могу анализировать ваши финансы, создавать операции и формировать отчёты. Задайте вопрос или выберите подсказку ниже.",
    time: getTime(),
  }
];

function renderText(text: string) {
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

export default function AiChat() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: Date.now(), role: "user", text, time: getTime() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setTimeout(() => {
      const reply = mockReplies.default;
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: "assistant", text: reply, time: getTime() }]);
      setLoading(false);
    }, 1400);
  };

  return (
    <div className="animate-fade-in card-fin flex flex-col" style={{ height: "calc(100vh - 180px)", minHeight: "480px" }}>
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
            <Icon name="Sparkles" size={16} className="text-gold" />
          </div>
          <div>
            <div className="text-sm font-medium">ФинансПро ИИ</div>
            <div className="text-xs text-positive flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-positive inline-block" />
              Онлайн
            </div>
          </div>
        </div>
        <div className="flex gap-2 text-muted-foreground">
          <button className="hover:text-foreground transition-colors p-1"><Icon name="RotateCcw" size={14} /></button>
          <button className="hover:text-foreground transition-colors p-1"><Icon name="Settings" size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${msg.role === "assistant" ? "bg-gold/20 text-gold" : "bg-secondary text-muted-foreground"}`}>
              {msg.role === "assistant" ? <Icon name="Sparkles" size={13} /> : <Icon name="User" size={13} />}
            </div>
            <div className={`max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
              <div className={`px-4 py-3 rounded-xl text-sm leading-relaxed ${msg.role === "assistant" ? "bg-secondary text-foreground rounded-tl-none" : "bg-gold text-primary-foreground rounded-tr-none"}`}
                dangerouslySetInnerHTML={{ __html: renderText(msg.text) }} />
              <span className="text-xs text-muted-foreground px-1">{msg.time}</span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-gold/20 flex items-center justify-center flex-shrink-0">
              <Icon name="Sparkles" size={13} className="text-gold" />
            </div>
            <div className="bg-secondary rounded-xl rounded-tl-none px-4 py-3 flex gap-1 items-center">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-border">
        <div className="flex gap-2 mb-3 flex-wrap">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)}
              className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:border-gold/40 hover:text-foreground transition-all">
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="Введите сообщение..."
            className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gold"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-lg bg-gold text-primary-foreground flex items-center justify-center hover:bg-yellow-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon name="Send" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
