import React, { useEffect, useMemo, useState } from "react";
import { cn } from "./lib/utils";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { BotControls } from "./components/BotControls";
import { TradingChart } from "./components/TradingChart";
import { NeonCard } from "./components/NeonCard";
import { derivService } from "./lib/deriv";
import { Badge } from "./components/ui/badge";
import {
  Activity, ArrowUpRight, ArrowDownRight, Clock,
  Menu, ShieldCheck, Link2, Link2Off, AlertTriangle,
  Mail, Lock, UserPlus, LogIn, Loader2,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { motion, AnimatePresence } from "motion/react";
import { Sheet, SheetContent, SheetTrigger } from "./components/ui/sheet";
import { HistoryPanel } from "./components/HistoryPanel";
import { SYMBOLS } from "./constants";
import { useConnectionStore, useBotStore, useMarketStore, useHistoryStore } from "./store";

export default function App() {
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // ── Stores ────────────────────────────────────────────────────────────────
  const {
    supabaseUser, authLoading, isLoggedIn,
    isAuthorized, balance, isDemo,
    derivTokenExpired, derivLoading,
    activeAccount, derivAccounts,
    initAuth, signIn, signUp, signOut,
    connectDeriv, disconnectDeriv,
    setIsAuthorized, setBalance,
  } = useConnectionStore();

  const { isBotRunning } = useBotStore();
  const { symbol, timeframe, candles, ticks, addTick } = useMarketStore();
  const { history, loadHistory } = useHistoryStore();

  // ── Inicialização ─────────────────────────────────────────────────────────
  useEffect(() => {
    initAuth();
  }, []);

  // ── Carregar histórico ────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabaseUser) return;
    loadHistory();
    const onUpdate = () => loadHistory();
    window.addEventListener("trade_history_updated", onUpdate);
    return () => window.removeEventListener("trade_history_updated", onUpdate);
  }, [supabaseUser]);

  // ── Listeners WebSocket ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthorized) return;

    const unsubBalance = derivService.on("balance", (data: any) => {
      if (!data.error) setBalance(data.balance.balance);
    });

    const unsubTick = derivService.on("tick", (data: any) => {
      if (data.tick) addTick({ time: data.tick.epoch, price: data.tick.quote });
    });

    const unsubPOC = derivService.on("proposal_open_contract", (data: any) => {
      if (data.proposal_open_contract?.is_sold)
        derivService.send({ balance: 1, subscribe: 1 });
    });

    return () => { unsubBalance(); unsubTick(); unsubPOC(); };
  }, [isAuthorized, timeframe]);

  // ── Listeners de autorização ──────────────────────────────────────────────
  useEffect(() => {
    const unsubAuth = derivService.on("authorize", (data: any) => {
      if (!data.error) {
        setIsAuthorized(true);
        setBalance(data.authorize.balance);
        derivService.subscribeProposalOpenContract();
        derivService.send({ balance: 1, subscribe: 1 });
        derivService.subscribeTicks(symbol);
      }
    });
    return () => unsubAuth();
  }, [symbol]);

  // ── Valores derivados ─────────────────────────────────────────────────────
  const currentPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : null;
  const prevPrice = ticks.length > 1 ? ticks[ticks.length - 2].price : null;
  const isUp = currentPrice && prevPrice ? currentPrice >= prevPrice : true;

  const stats = useMemo(() => {
    const wins = history.filter((h) => h.status === "WON").length;
    const total = history.length;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const totalProfit = history.reduce((acc, h) => acc + (h.profit || 0), 0);
    return { winRate, totalProfit };
  }, [history]);

  const hasRealAccount = derivAccounts.some((a) => !a.is_demo);
  const hasDemoAccount = derivAccounts.some((a) => a.is_demo);

  // ── Estado 1: A carregar sessão ───────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
          <p className="text-muted-foreground text-sm font-bold uppercase tracking-widest">A carregar...</p>
        </div>
      </div>
    );
  }

  // ── Estado 2: Não autenticado → Login / Registo ───────────────────────────
  if (!isLoggedIn) {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;
  }

  // ── Estado 3: Autenticado mas sem Deriv → Ecrã de conexão ────────────────
  if (!isAuthorized && !derivLoading && (!activeAccount)) {
    return (
      <ConnectDerivScreen
        userEmail={supabaseUser?.email || ""}
        onConnect={connectDeriv}
        onSignOut={signOut}
      />
    );
  }

  // ── Estado 4: Dashboard operacional ──────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-[#0a0a0c] text-slate-200 font-sans selection:bg-purple-500/30">
      <div className="hidden lg:block">
        <Sidebar onLogout={signOut} activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        <Header />

        {/* Banner: token Deriv expirado */}
        {derivTokenExpired && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-[11px] text-amber-300 font-bold uppercase tracking-wide">
                Sessão Deriv expirada — é necessário reconectar
              </p>
            </div>
            <Button
              size="sm"
              onClick={connectDeriv}
              className="h-7 text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 uppercase font-bold"
            >
              Reconectar Deriv
            </Button>
          </div>
        )}

        {/* Mobile header */}
        <div className="lg:hidden px-6 py-3 border-b border-white/5 flex items-center justify-between bg-black/40">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger render={
              <Button variant="ghost" size="icon" className="text-purple-400">
                <Menu className="w-6 h-6" />
              </Button>
            } />
            <SheetContent side="left" className="p-0 w-64 bg-[#0a0a0c] border-r border-white/10">
              <Sidebar onLogout={signOut} activeTab={activeTab} setActiveTab={setActiveTab} closeMobile={() => setIsMobileMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Live Server</span>
          </div>
        </div>

        {/* Loading overlay enquanto conecta Deriv */}
        {derivLoading && (
          <div className="flex items-center justify-center gap-3 p-4 bg-blue-500/10 border-b border-blue-500/20">
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            <span className="text-[11px] text-blue-300 font-bold uppercase tracking-wide">A conectar à Deriv...</span>
          </div>
        )}

        <div className="flex-1 overflow-x-hidden">
          <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl mx-auto w-full">
            {activeTab === "Histórico" ? (
              <HistoryPanel />
            ) : (
              <>
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                  <NeonCard variant="purple" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                    <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Ativo</p>
                    <div className="flex items-end justify-between">
                      <h2 className="text-sm md:text-lg font-black tracking-tight truncate">
                        {SYMBOLS.find((s) => s.value === symbol)?.label || "Synthetic"}
                      </h2>
                      <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/50 text-[8px] md:text-[10px]">LIVE</Badge>
                    </div>
                  </NeonCard>

                  <NeonCard variant={isUp ? "cyan" : "pink"} className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                    <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Preço</p>
                    <div className="flex items-center gap-1 md:gap-2">
                      <span className={cn("text-sm md:text-xl font-black tracking-tighter transition-colors duration-300",
                        isUp ? "text-cyan-400" : "text-pink-400")}>
                        {currentPrice ? currentPrice.toFixed(2) : "---"}
                      </span>
                      {isUp ? <ArrowUpRight className="text-cyan-400 w-3 h-3 md:w-5 md:h-5" /> : <ArrowDownRight className="text-pink-400 w-3 h-3 md:w-5 md:h-5" />}
                    </div>
                  </NeonCard>

                  <NeonCard variant="blue" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                    <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Lucro</p>
                    <h2 className={cn("text-sm md:text-xl font-black tracking-tighter",
                      stats.totalProfit >= 0 ? "text-blue-400" : "text-red-400")}>
                      {stats.totalProfit >= 0 ? "+" : ""}${stats.totalProfit.toFixed(2)}
                    </h2>
                  </NeonCard>

                  <NeonCard variant="purple" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                    <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Assertividade</p>
                    <div className="flex items-end justify-between">
                      <h2 className="text-sm md:text-xl font-black tracking-tighter text-purple-400">{stats.winRate}%</h2>
                      <div className="hidden md:flex gap-1">
                        {history.slice(0, 5).map((h, i) => (
                          <div key={i} className={cn("w-2 h-2 rounded-full", h.status === "WON" ? "bg-green-500" : "bg-red-500")} />
                        ))}
                      </div>
                    </div>
                  </NeonCard>
                </div>

                {/* Main Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
                  <div className="lg:col-span-2 space-y-6 md:space-y-8">
                    <NeonCard variant="purple" className="p-4 md:p-6">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 md:w-5 md:h-5 text-purple-500" />
                          <h3 className="font-bold uppercase tracking-widest text-[10px] md:text-sm">Market Analysis</h3>
                        </div>
                        <Badge variant="outline" className="border-purple-500/50 text-purple-400 text-[8px] md:text-[10px]">REAL-TIME</Badge>
                      </div>
                      <TradingChart candles={candles} symbol={symbol} />
                    </NeonCard>
                    <BotControls />
                  </div>

                  {/* Sidebar */}
                  <div className="space-y-6 md:space-y-8">
                    {/* Conta Deriv */}
                    <NeonCard variant="purple" className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-2">
                          <Link2 className="w-3 h-3" /> Conta Deriv
                        </p>
                        <Button variant="ghost" size="sm" onClick={disconnectDeriv}
                          className="h-6 text-[9px] text-red-400 hover:text-red-300 uppercase font-bold px-2">
                          <Link2Off className="w-3 h-3 mr-1" /> Desconectar
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-white">{activeAccount?.account_id || "—"}</span>
                          <Badge className={cn("text-[8px]", isDemo ? "bg-blue-500/20 text-blue-400 border-blue-500/40" : "bg-red-500/20 text-red-400 border-red-500/40")}>
                            {isDemo ? "Demo" : "Real"}
                          </Badge>
                        </div>
                        {/* Troca Demo/Real — só mostra se tiver ambas */}
                        {hasDemoAccount && hasRealAccount && (
                          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                            <button onClick={() => useConnectionStore.getState().switchAccount(true)}
                              className={cn("flex-1 py-1 rounded-md text-[9px] font-black uppercase transition-all",
                                isDemo ? "bg-blue-600/80 text-white" : "text-muted-foreground hover:text-white")}>
                              Demo
                            </button>
                            <button onClick={() => useConnectionStore.getState().switchAccount(false)}
                              disabled={isBotRunning}
                              className={cn("flex-1 py-1 rounded-md text-[9px] font-black uppercase transition-all",
                                !isDemo ? "bg-red-600/80 text-white" : "text-muted-foreground hover:text-white disabled:opacity-40")}>
                              Real
                            </button>
                          </div>
                        )}
                      </div>
                    </NeonCard>

                    {/* Histórico recente */}
                    <NeonCard variant="blue" className="p-4 md:p-6 flex flex-col h-full min-h-[340px]">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="font-bold uppercase tracking-widest text-[10px] md:text-sm flex items-center gap-2">
                          <Clock className="w-4 h-4 text-blue-500" />Histórico
                        </h3>
                      </div>
                      <div className="space-y-3 flex-1">
                        <AnimatePresence mode="popLayout">
                          {history.length > 0 ? history.slice(0, 8).map((trade) => (
                            <motion.div key={trade.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                              className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between hover:border-blue-500/30 transition-all">
                              <div className="flex items-center gap-3">
                                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center",
                                  trade.profit && trade.profit > 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                                  {trade.profit && trade.profit > 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                                </div>
                                <div>
                                  <p className="text-xs font-bold truncate max-w-[80px]">{trade.symbol}</p>
                                  <p className="text-[9px] text-muted-foreground">{new Date(trade.time).toLocaleTimeString()}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className={cn("text-xs font-black", trade.profit && trade.profit > 0 ? "text-green-400" : "text-red-400")}>
                                  {trade.profit && trade.profit > 0 ? "+" : ""}${trade.profit?.toFixed(2)}
                                </p>
                                <Badge variant="outline" className={cn("text-[8px] py-0 h-3 uppercase",
                                  trade.profit && trade.profit > 0 ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400")}>
                                  {trade.profit && trade.profit > 0 ? "WON" : "LOSS"}
                                </Badge>
                              </div>
                            </motion.div>
                          )) : (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-20 py-16">
                              <Activity className="w-12 h-12 mb-2" /><p className="text-xs uppercase font-bold">Sem operações</p>
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                      <Button variant="ghost" onClick={() => setActiveTab("Histórico")}
                        className="w-full mt-4 text-[10px] text-muted-foreground hover:text-blue-400 uppercase font-bold">
                        Relatório Completo
                      </Button>
                    </NeonCard>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Ecrã de Autenticação ──────────────────────────────────────────────────────

function AuthScreen({
  onSignIn,
  onSignUp,
}: {
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignUp: (email: string, password: string) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email || !password) { setError("Preencha email e password."); return; }
    setLoading(true);
    setError(null);
    const err = mode === "login"
      ? await onSignIn(email, password)
      : await onSignUp(email, password);
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="w-20 h-20 bg-white rounded-2xl mx-auto flex items-center justify-center rotate-3 hover:rotate-0 transition-transform duration-300 overflow-hidden">
            <img src="https://lh3.googleusercontent.com/d/19uIpRxexOi6-7EZX-eMVHf3ewi3BxEys" alt="X-ONE" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter neon-text-purple mt-6">X-ONE</h1>
          <p className="text-muted-foreground font-medium uppercase tracking-widest text-[10px]">Intelligence Trading Bot</p>
        </div>

        <NeonCard variant="purple" className="p-8 space-y-6">
          {/* Tabs Login / Registo */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
            <button onClick={() => { setMode("login"); setError(null); }}
              className={cn("flex-1 py-2 rounded-lg text-[11px] font-black uppercase transition-all flex items-center justify-center gap-2",
                mode === "login" ? "bg-purple-600 text-white shadow-lg" : "text-muted-foreground hover:text-white")}>
              <LogIn className="w-3 h-3" /> Entrar
            </button>
            <button onClick={() => { setMode("register"); setError(null); }}
              className={cn("flex-1 py-2 rounded-lg text-[11px] font-black uppercase transition-all flex items-center justify-center gap-2",
                mode === "register" ? "bg-purple-600 text-white shadow-lg" : "text-muted-foreground hover:text-white")}>
              <UserPlus className="w-3 h-3" /> Criar conta
            </button>
          </div>

          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400 font-bold animate-pulse">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input type="email" placeholder="o.teu@email.com" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="bg-black/40 border-white/10 h-12 pl-10 focus:border-purple-500/50" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input type="password" placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="bg-black/40 border-white/10 h-12 pl-10 focus:border-purple-500/50" />
              </div>
            </div>

            <Button onClick={handleSubmit} disabled={loading || !email || !password}
              className="w-full h-12 bg-purple-600 hover:bg-purple-700 font-black uppercase tracking-widest shadow-xl shadow-purple-500/20 active:scale-95 transition-all disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === "login" ? "Entrar no Painel" : "Criar Conta"}
            </Button>
          </div>
        </NeonCard>
        <p className="text-center text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-50">Powered by Quantitative Algorithms</p>
      </div>
    </div>
  );
}

// ── Ecrã de Conexão Deriv ─────────────────────────────────────────────────────

function ConnectDerivScreen({
  userEmail,
  onConnect,
  onSignOut,
}: {
  userEmail: string;
  onConnect: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="text-center space-y-2">
          <div className="w-20 h-20 bg-white rounded-2xl mx-auto flex items-center justify-center rotate-3 hover:rotate-0 transition-transform duration-300 overflow-hidden">
            <img src="https://lh3.googleusercontent.com/d/19uIpRxexOi6-7EZX-eMVHf3ewi3BxEys" alt="X-ONE" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter neon-text-purple mt-6">X-ONE</h1>
          <p className="text-muted-foreground font-medium uppercase tracking-widest text-[10px]">Intelligence Trading Bot</p>
        </div>

        <NeonCard variant="blue" className="p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-500" /> Conta criada
              </h2>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-[9px]">✓ Autenticado</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">{userEmail}</p>
          </div>

          <div className="h-px bg-white/10" />

          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Link2 className="w-4 h-4 text-blue-400" /> Conectar à Deriv
              </h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Para operar, precisas de autorizar o acesso à tua conta Deriv via OAuth. Serás redirecionado e voltarás automaticamente.
              </p>
            </div>

            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[10px] text-blue-300 space-y-1">
              <p className="font-bold uppercase">O que acontece a seguir:</p>
              <p>1. Redirecionamento para oauth.deriv.com</p>
              <p>2. Login/autorização na Deriv</p>
              <p>3. Regresso automático ao X-ONE</p>
              <p>4. Bot pronto a operar</p>
            </div>

            <Button onClick={onConnect}
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all">
              <Link2 className="w-5 h-5 mr-2" /> Conectar Deriv
            </Button>
          </div>
        </NeonCard>

        <div className="text-center">
          <button onClick={onSignOut} className="text-[10px] text-muted-foreground hover:text-white uppercase font-bold tracking-widest transition-colors">
            Terminar sessão
          </button>
        </div>
      </div>
    </div>
  );
}
