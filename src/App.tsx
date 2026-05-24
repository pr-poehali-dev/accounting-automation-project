import { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Icon from "@/components/ui/icon";
import Dashboard from "@/pages/Dashboard";
import Transactions from "@/pages/Transactions";
import Documents from "@/pages/Documents";
import AiChat from "@/pages/AiChat";
import TaxReports from "@/pages/TaxReports";
import AdminSettings from "@/pages/AdminSettings";

type Section = "dashboard" | "transactions" | "documents" | "chat" | "taxes" | "admin";

const nav: { id: Section; label: string; icon: string; shortLabel: string; badge?: string }[] = [
  { id: "dashboard", label: "Главная", shortLabel: "Главная", icon: "LayoutDashboard" },
  { id: "transactions", label: "История операций", shortLabel: "Операции", icon: "List" },
  { id: "documents", label: "Документы", shortLabel: "Документы", icon: "ScanLine", badge: "ИИ" },
  { id: "chat", label: "ИИ-ассистент", shortLabel: "ИИ-чат", icon: "MessageSquare", badge: "ИИ" },
  { id: "taxes", label: "Налоговая отчётность", shortLabel: "Отчёты", icon: "FileBarChart" },
  { id: "admin", label: "Настройки", shortLabel: "Настройки", icon: "Settings2" },
];

const titles: Record<Section, string> = {
  dashboard: "Обзор",
  transactions: "История операций",
  documents: "Документы",
  chat: "ИИ-ассистент",
  taxes: "Налоговая отчётность",
  admin: "Настройки",
};

const App = () => {
  const [section, setSection] = useState<Section>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const content = {
    dashboard: <Dashboard onNavigate={(s) => setSection(s as Section)} />,
    transactions: <Transactions />,
    documents: <Documents />,
    chat: <AiChat />,
    taxes: <TaxReports />,
    admin: <AdminSettings />,
  }[section];

  return (
    <TooltipProvider>
      <Toaster />
      <div className="flex h-[100dvh] bg-background overflow-hidden">

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Desktop sidebar */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-30 w-60 flex flex-col
          bg-sidebar border-r border-sidebar-border
          transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}>
          <div className="px-4 py-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3 group cursor-default">
              {/* BG Logo mark — hexagon monogram */}
              <div className="flex-shrink-0 w-9 h-9 relative transition-transform duration-300 group-hover:scale-105">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <polygon points="18,2 33,10 33,26 18,34 3,26 3,10" fill="#0F172A" stroke="#0284C7" strokeWidth="1.5"/>
                  <text x="18" y="23" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="12" fill="#ffffff" letterSpacing="-0.5">BG</text>
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight tracking-tight text-foreground">Butsky Group</div>
                <div className="text-[11px] text-[#0284C7] font-medium tracking-wide">Финансовые технологии</div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-3 px-2">
            <div className="text-xs text-muted-foreground uppercase tracking-widest px-3 mb-2">Навигация</div>
            <nav className="space-y-0.5">
              {nav.map((item) => {
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setSection(item.id); setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                      active
                        ? "bg-sidebar-accent text-foreground font-medium"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    }`}
                  >
                    <Icon name={item.icon} size={16} className={active ? "text-gold" : ""} />
                    <span className="flex-1 text-left">{item.label}</span>
                    {active && <span className="w-1 h-4 rounded-full bg-gold" />}
                    {item.badge && !active && (
                      <span className="text-xs bg-gold/20 text-gold px-1.5 py-0.5 rounded font-mono-fin">{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-4 border-t border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#0284C7]/15 border border-[#0284C7]/30 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-[#0284C7]">ДБ</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">Администратор</div>
                <div className="text-[11px] text-muted-foreground truncate">Butsky Group</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header */}
          <header className="h-12 lg:h-14 border-b border-border flex items-center gap-3 px-4 flex-shrink-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1"
            >
              <Icon name="Menu" size={20} />
            </button>

            <div className="flex-1 flex items-center gap-2 min-w-0">
              <h1 className="text-sm font-semibold truncate">{titles[section]}</h1>
              <span className="text-border hidden sm:block">·</span>
              <span className="text-xs text-muted-foreground font-mono-fin hidden sm:block">21 мая 2026</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button className="relative w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
                <Icon name="Bell" size={16} />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-gold" />
              </button>
              <div className="hidden sm:flex items-center gap-1.5">
                <button className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
                  <Icon name="HelpCircle" size={16} />
                </button>
                <div className="h-5 w-px bg-border mx-1" />
              </div>
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-secondary transition-all duration-300 cursor-pointer">
                <div className="w-6 h-6 rounded-full bg-[#0284C7]/20 border border-[#0284C7]/40 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-[#0284C7]">ДБ</span>
                </div>
                <span className="text-xs hidden sm:block font-medium">Администратор</span>
              </div>
            </div>
          </header>

          {/* Page content — on mobile leave space for bottom nav */}
          <main className="flex-1 overflow-y-auto p-3 sm:p-5 pb-20 lg:pb-5">
            {content}
          </main>
        </div>

        {/* Mobile bottom navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-sidebar flex">
          {nav.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative ${
                  active ? "text-gold" : "text-muted-foreground"
                }`}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-gold" />
                )}
                <Icon name={item.icon} size={18} />
                <span className="text-[10px] leading-none">{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </TooltipProvider>
  );
};

export default App;