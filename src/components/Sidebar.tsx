import React from "react";
import { 
  LayoutDashboard, 
  History, 
  Settings, 
  Bot, 
  HelpCircle, 
  LogOut,
  Zap
} from "lucide-react";
import { cn } from "../lib/utils";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: Bot, label: "Estratégias" },
  { icon: History, label: "Histórico" },
  { icon: Settings, label: "Configurações" },
];

interface SidebarProps {
  onLogout?: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  closeMobile?: () => void;
}

export const Sidebar = ({ onLogout, activeTab, setActiveTab, closeMobile }: SidebarProps) => {
  const handleItemClick = (label: string) => {
    setActiveTab(label);
    if (closeMobile) closeMobile();
  };

  return (
    <aside className="w-64 border-r border-white/10 bg-black/40 backdrop-blur-xl flex flex-col h-screen sticky top-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center neon-border-purple shrink-0 overflow-hidden">
          <img src="https://lh3.googleusercontent.com/d/19uIpRxexOi6-7EZX-eMVHf3ewi3BxEys" alt="X-ONE Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
        </div>
        <h1 className="text-2xl font-black tracking-tighter neon-text-purple">X-ONE</h1>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = activeTab === item.label;
          return (
            <button
              key={item.label}
              onClick={() => handleItemClick(item.label)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                isActive 
                  ? "bg-purple-600/20 text-purple-400 border border-purple-500/30" 
                  : "text-muted-foreground hover:bg-white/5 hover:text-white"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 shrink-0",
                isActive ? "text-purple-400" : "group-hover:text-white"
              )} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10">
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-all"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          <span className="font-medium">Terminar sessão</span>
        </button>
      </div>
    </aside>
  );
};
