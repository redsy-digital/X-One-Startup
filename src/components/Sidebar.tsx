import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import {
  Home, LayoutDashboard, History, Terminal,
  TrendingUp, Settings
} from "lucide-react";

interface SidebarProps {
  onLogout?: () => void;
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  closeMobile?: () => void;
}

const menuItems = [
  { icon: Home,            label: "Home",         path: "/" },
  { icon: LayoutDashboard, label: "Dashboard",    path: "/dashboard" },
  { icon: History,         label: "Histórico",    path: "/historico" },
  { icon: Terminal,        label: "Logs",         path: "/logs" },
  { icon: TrendingUp,      label: "Estratégias",  path: "/estrategias" },
  { icon: Settings,        label: "Configurações",path: "/configuracoes" },
];

export const Sidebar = ({ closeMobile }: SidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNav = (path: string) => {
    navigate(path);
    closeMobile?.();
  };

  return (
    <div className="h-full w-64 bg-[#0a0a0c] border-r border-white/5 flex flex-col py-6 px-4">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2 mb-8">
        <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
          <span className="text-purple-400 font-black text-sm">X</span>
        </div>
        <div>
          <span className="font-black text-white tracking-tight">X-ONE</span>
          <p className="text-[9px] text-muted-foreground uppercase tracking-widest">Intelligence</p>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1">
        {menuItems.map(({ icon: Icon, label, path }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => handleNav(path)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 text-left",
                isActive
                  ? "bg-purple-600/20 text-white border border-purple-500/30"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-purple-400" : "")} />
              <span className="font-bold">{label}</span>
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-purple-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 pt-4 border-t border-white/5">
        <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest font-bold text-center">
          v2.0 PRO
        </p>
      </div>
    </div>
  );
};
