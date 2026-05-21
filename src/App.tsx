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

const nav: { id: Section; label: string; icon: string; badge?: string }[] = [
  { id: "dashboard", label: "Главная", icon: "LayoutDashboard" },
  { id: "transactions", label: "История операций", icon: "List" },
  { id: "documents", label: "Документы", icon: "ScanLine", badge: "ИИ" },
  { id: "chat", label: "ИИ-ассистент", icon: "MessageSquare", badge: "ИИ" },
  { id: "taxes", label: "Налоговая отчётность", icon: "FileBarChart" },
  { id: "admin", label: "Настройки", icon: "Settings2" },
];

const titles: Record<Section, string> = {
  dashboard: "Обзор",
  transactions: "История операций",
  documents: "Документы",
  chat: "ИИ-ассистент",
  taxes: "Налоговая отчётность",
  admin: "Настройки администратора",
};

const App = () => {
  const [section, setSection] = useState<Section>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const content = {
    dashboard: <Dashboard />,
    transactions: <Transactions />,
    documents: <Documents />,
    chat: <AiChat />,
    taxes: <TaxReports />,
    admin: <AdminSettings />,
  }[section];

  return (
    <TooltipProvider>
      <Toaster />
      <div className="flex h-screen bg-background overflow-hidden">
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={`
          fixed lg:static inset-y-0 left-0 z-30 w-60 flex flex-col
          bg-sidebar border-r border-sidebar-border
          transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}>
          <div className="px-5 py-5 border-b border-sidebar-border">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-gold flex items-center justify-center">
                <Icon name="BarChart3" size={15} className="text-primary-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">ФинансПро</div>
                <div className="text-xs text-muted-foreground">B2B Платформа</div>
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
              <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
                <Icon name="User" size={14} className="text-gold" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">Администратор</div>
                <div className="text-xs text-muted-foreground truncate">admin@company.ru</div>
              </div>
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <Icon name="LogOut" size={13} />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-border flex items-center gap-3 px-5 flex-shrink-0">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-muted-foreground hover:text-foreground transition-colors">
              <Icon name="Menu" size={20} />
            </button>

            <div className="flex-1 flex items-center gap-2">
              <h1 className="text-sm font-semibold">{titles[section]}</h1>
              <span className="text-border mx-1">·</span>
              <span className="text-xs text-muted-foreground font-mono-fin">21 мая 2026</span>
            </div>

            <div className="flex items-center gap-2">
              <button className="relative w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
                <Icon name="Bell" size={16} />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-gold" />
              </button>
              <button className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
                <Icon name="HelpCircle" size={16} />
              </button>
              <div className="h-5 w-px bg-border mx-1" />
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-secondary transition-colors cursor-pointer">
                <div className="w-6 h-6 rounded-full bg-gold flex items-center justify-center">
                  <span className="text-xs font-semibold text-primary-foreground">А</span>
                </div>
                <span className="text-xs hidden sm:block">Администратор</span>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-5">
            {content}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default App;
