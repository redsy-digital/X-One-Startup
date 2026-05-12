import React from "react";
import { Bell, Wallet, Info } from "lucide-react";
import { Switch } from "./ui/switch";
import { cn } from "../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface HeaderProps {
  balance: number | null;
  isDemo: boolean;
  setIsDemo: (val: boolean) => void;
  isBotRunning: boolean;
}

export const Header = ({ balance, isDemo, setIsDemo, isBotRunning }: HeaderProps) => {
  return (
    <header className="h-16 md:h-20 border-b border-white/10 px-4 md:px-8 flex items-center justify-between bg-black/20 backdrop-blur-md sticky top-0 z-50 shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 bg-white/5 p-1 rounded-xl border border-white/10">
          <button 
            onClick={() => !isBotRunning && setIsDemo(true)}
            disabled={isBotRunning}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
              isDemo ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20" : "text-muted-foreground hover:text-white"
            )}
          >
            Demo
          </button>
          <button 
            onClick={() => !isBotRunning && setIsDemo(false)}
            disabled={isBotRunning}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
              !isDemo ? "bg-red-600 text-white shadow-lg shadow-red-500/20" : "text-muted-foreground hover:text-white"
            )}
          >
            Real
          </button>
        </div>
        
        {isBotRunning && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-4 h-4 text-orange-400 opacity-50" />
              </TooltipTrigger>
              <TooltipContent className="bg-[#111114] border-white/10 text-white text-[10px]">
                Pare a IA para trocar de conta
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="flex items-center gap-3 md:gap-6">
        <div className="flex items-center gap-4 pl-4 md:pl-6 border-l border-white/10">
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-widest">Saldo Disponível</span>
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-purple-500" />
              <span className="text-sm md:text-lg font-black tracking-tighter text-white">
                {balance !== null ? `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : "Cargando..."}
              </span>
            </div>
          </div>

          <button className="relative p-2 text-muted-foreground hover:text-white transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-purple-500 rounded-full neon-border-purple"></span>
          </button>
        </div>
      </div>
    </header>
  );
};
