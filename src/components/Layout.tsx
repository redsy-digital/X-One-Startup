import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { Menu } from "lucide-react";
import { useConnectionStore } from "../store";

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useConnectionStore();

  // Map path to active tab label for Sidebar highlight
  const pathToTab: Record<string, string> = {
    "/": "Home",
    "/dashboard": "Dashboard",
    "/historico": "Histórico",
    "/logs": "Logs",
    "/estrategias": "Estratégias",
    "/configuracoes": "Configurações",
  };

  const activeTab = pathToTab[location.pathname] || "Dashboard";

  const handleTabChange = (tab: string) => {
    const tabToPath: Record<string, string> = {
      "Home": "/",
      "Dashboard": "/dashboard",
      "Histórico": "/historico",
      "Logs": "/logs",
      "Estratégias": "/estrategias",
      "Configurações": "/configuracoes",
    };
    const path = tabToPath[tab];
    if (path) navigate(path);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-[#0a0a0c] text-slate-200 font-sans">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          onLogout={signOut}
          activeTab={activeTab}
          setActiveTab={handleTabChange}
        />
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        <Header />

        {/* Mobile top bar */}
        <div className="lg:hidden px-4 py-3 border-b border-white/5 flex items-center justify-between bg-black/40">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger render={
              <Button variant="ghost" size="icon" className="text-purple-400">
                <Menu className="w-6 h-6" />
              </Button>
            } />
            <SheetContent side="left" className="p-0 w-64 bg-[#0a0a0c] border-r border-white/10">
              <Sidebar
                onLogout={signOut}
                activeTab={activeTab}
                setActiveTab={handleTabChange}
                closeMobile={() => setIsMobileMenuOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {activeTab}
            </span>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-x-hidden">
          <div className="p-4 md:p-8 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};
