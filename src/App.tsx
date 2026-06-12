import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Loader2, Mail, Lock, LogIn, UserPlus, ShieldCheck, Link2, Loader } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { NeonCard } from "./components/NeonCard";
import { Layout } from "./components/Layout";
import { BotControls } from "./components/BotControls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { derivService } from "./lib/deriv";
import { logger } from "./lib/logger";
import { useConnectionStore, useBotStore, useMarketStore, useHistoryStore } from "./store";

// ── Lazy page imports ─────────────────────────────────────────────────────────
const HomePage       = React.lazy(() => import("./pages/HomePage").then(m => ({ default: m.HomePage })));
const DashboardPage  = React.lazy(() => import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const HistoricoPage  = React.lazy(() => import("./pages/HistoricoPage").then(m => ({ default: m.HistoricoPage })));
const LogsPage       = React.lazy(() => import("./pages/LogsPage").then(m => ({ default: m.LogsPage })));
const EstrategiasPage = React.lazy(() => import("./pages/EstrategiasPage").then(m => ({ default: m.EstrategiasPage })));
const ConfigPage     = React.lazy(() => import("./pages/ConfigPage").then(m => ({ default: m.ConfigPage })));

// ── Loading spinner ───────────────────────────────────────────────────────────
const PageLoader = () => (
  <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
    <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
    <p className="text-[11px] text-muted-foreground uppercase font-bold tracking-widest">A carregar...</p>
  </div>
);

// ── Protected route: requires Deriv connection ────────────────────────────────
const DerivGuard = ({ children }: { children: React.ReactNode }) => {
  const { isAuthorized, activeAccount, derivLoading } = useConnectionStore();
  const navigate = useNavigate();

  if (derivLoading) {
    return <PageLoader />;
  }

  if (!isAuthorized && !activeAccount) {
    return <ConnectDerivScreen />;
  }

  return <>{children}</>;
};

// ── Ecrã de conexão Deriv ─────────────────────────────────────────────────────
const ConnectDerivScreen = () => {
  const { connectWithPAT, derivError, derivLoading } = useConnectionStore();
  const [pat, setPat] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleConnect = async () => {
    if (!pat.trim()) { setError("Cola o teu token de acesso."); return; }
    setLoading(true); setError(null);
    const err = await connectWithPAT(pat.trim());
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <NeonCard variant="blue" className="p-8 space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-400" /> Conectar à Deriv
            </h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Cola o teu <span className="text-blue-300 font-bold">API Token</span> da Deriv.
              Gera-o em <span className="text-white font-bold">developers.deriv.com</span> → Dashboard → API Tokens → Read + Trade.
            </p>
          </div>

          {(error || derivError) && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400 font-bold">
              {error || derivError}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">API Token (pat_...)</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="password" placeholder="pat_0a1b2c3d..." value={pat}
                onChange={e => setPat(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleConnect()}
                className="bg-black/40 border-white/10 h-12 pl-10 font-mono focus:border-blue-500/50" />
            </div>
          </div>

          <Button onClick={handleConnect} disabled={loading || !pat.trim() || derivLoading}
            className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 font-black uppercase tracking-widest disabled:opacity-50">
            {loading || derivLoading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <><Link2 className="w-5 h-5 mr-2" /> Conectar Deriv</>
            }
          </Button>
        </NeonCard>
      </div>
    </div>
  );
};

// ── Ecrã de autenticação ──────────────────────────────────────────────────────
const AuthScreen = () => {
  const { signIn, signUp } = useConnectionStore();
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email || !password) { setError("Preenche email e password."); return; }
    setLoading(true); setError(null);
    const err = mode === "login"
      ? await signIn(email, password)
      : await signUp(email, password);
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-4"
      style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124,58,237,0.15) 0%, transparent 70%), #0a0a0c" }}>
      <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="w-20 h-20 bg-white rounded-2xl mx-auto flex items-center justify-center overflow-hidden rotate-3 hover:rotate-0 transition-transform duration-300">
            <img src="https://lh3.googleusercontent.com/d/19uIpRxexOi6-7EZX-eMVHf3ewi3BxEys"
              alt="X-ONE" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter mt-6"
            style={{ textShadow: "0 0 20px rgba(124,58,237,0.8)" }}>X-ONE</h1>
          <p className="text-muted-foreground font-medium uppercase tracking-widest text-[10px]">
            Intelligence Trading Bot
          </p>
        </div>

        <NeonCard variant="purple" className="p-8 space-y-6">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
            {(["login", "register"] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null); }}
                className={cn("flex-1 py-2 rounded-lg text-[11px] font-black uppercase transition-all flex items-center justify-center gap-2",
                  mode === m ? "bg-purple-600 text-white shadow-lg" : "text-muted-foreground hover:text-white")}>
                {m === "login" ? <><LogIn className="w-3 h-3" /> Entrar</> : <><UserPlus className="w-3 h-3" /> Criar conta</>}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400 font-bold">
                {error}
              </div>
            )}
            {[
              { label: "Email", type: "email", value: email, set: setEmail, icon: <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />, placeholder: "o.teu@email.com" },
              { label: "Password", type: "password", value: password, set: setPassword, icon: <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />, placeholder: "••••••••" },
            ].map(({ label, type, value, set, icon, placeholder }) => (
              <div key={label} className="space-y-2">
                <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider ml-1">{label}</label>
                <div className="relative">
                  {icon}
                  <Input type={type} placeholder={placeholder} value={value}
                    onChange={e => set(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    className="bg-black/40 border-white/10 h-12 pl-10 focus:border-purple-500/50" />
                </div>
              </div>
            ))}
            <Button onClick={handleSubmit} disabled={loading || !email || !password}
              className="w-full h-12 bg-purple-600 hover:bg-purple-700 font-black uppercase tracking-widest shadow-xl shadow-purple-500/20 disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === "login" ? "Entrar no Painel" : "Criar Conta"}
            </Button>
          </div>
        </NeonCard>
        <p className="text-center text-[10px] text-muted-foreground/50 font-bold uppercase tracking-widest">
          Powered by Quantitative Algorithms
        </p>
      </div>
    </div>
  );
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ── App principal ─────────────────────────────────────────────────────────────
export default function App() {
  const {
    supabaseUser, authLoading, isLoggedIn,
    isAuthorized, setIsAuthorized, setBalance, setIsLoggedIn,
    initAuth,
  } = useConnectionStore();
  const { addTick } = useMarketStore();
  const { loadHistory } = useHistoryStore();

  // Inicializar auth
  useEffect(() => { initAuth(); }, []);

  // Listeners WebSocket permanentes
  useEffect(() => {
    const unsubTick = derivService.on("tick", (data: any) => {
      if (data.tick) addTick({ time: data.tick.epoch, price: data.tick.quote });
    });
    const unsubBalance = derivService.on("balance", (data: any) => {
      if (!data.error) setBalance(data.balance.balance);
    });
    const unsubPOC = derivService.on("proposal_open_contract", (data: any) => {
      if (data.proposal_open_contract?.is_sold)
        derivService.send({ balance: 1, subscribe: 1 });
    });
    const unsubAuth = derivService.on("authorize", (data: any) => {
      if (!data.error) {
        setIsAuthorized(true);
        setBalance(data.authorize.balance);
        derivService.subscribeProposalOpenContract();
        derivService.send({ balance: 1, subscribe: 1 });
        // Iniciar feed de ticks — essencial para o gráfico
        const { symbol } = useMarketStore.getState();
        derivService.subscribeTicks(symbol);
      } else {
        logger.error(`Auth Deriv: ${data.error.message}`);
      }
    });
    return () => { unsubTick(); unsubBalance(); unsubPOC(); unsubAuth(); };
  }, []);

  // Re-subscrever ticks quando símbolo muda (já autorizado)
  const { symbol } = useMarketStore();
  const isAuthorizedRef = React.useRef(false);
  useEffect(() => { isAuthorizedRef.current = isAuthorized; }, [isAuthorized]);
  useEffect(() => {
    if (!isAuthorizedRef.current) return;
    derivService.unsubscribeTicks(symbol);
    derivService.subscribeTicks(symbol);
  }, [symbol]);

  // Carregar histórico quando user autentica
  useEffect(() => {
    if (supabaseUser) {
      loadHistory().catch(console.error);
    }
  }, [supabaseUser]);

  // Loading inicial
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

  // Não autenticado → ecrã de login
  if (!isLoggedIn) return <AuthScreen />;

  // Autenticado → rotas
  return (
    <>
      {/* BotControls sempre montado quando autorizado — bot opera em qualquer página */}
      {isAuthorized && (
        <div style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }} aria-hidden="true">
          <ErrorBoundary fallbackLabel="">
            <BotControls />
          </ErrorBoundary>
        </div>
      )}
      <Routes>
      {/* Home — com Layout (Header + Sidebar como as outras páginas) */}
      <Route path="/" element={
        <Layout>
          <ErrorBoundary fallbackLabel="Erro na Home">
            <React.Suspense fallback={<PageLoader />}>
              <HomePage />
            </React.Suspense>
          </ErrorBoundary>
        </Layout>
      } />

      {/* Páginas com sidebar + Deriv guard */}
      <Route path="/dashboard" element={
        <Layout>
          <DerivGuard>
            <ErrorBoundary fallbackLabel="Erro no Dashboard">
              <React.Suspense fallback={<PageLoader />}>
                <DashboardPage />
              </React.Suspense>
            </ErrorBoundary>
          </DerivGuard>
        </Layout>
      } />

      <Route path="/historico" element={
        <Layout>
          <ErrorBoundary fallbackLabel="Erro no Histórico">
            <React.Suspense fallback={<PageLoader />}>
              <HistoricoPage />
            </React.Suspense>
          </ErrorBoundary>
        </Layout>
      } />

      <Route path="/logs" element={
        <Layout>
          <ErrorBoundary fallbackLabel="Erro nos Logs">
            <React.Suspense fallback={<PageLoader />}>
              <LogsPage />
            </React.Suspense>
          </ErrorBoundary>
        </Layout>
      } />

      <Route path="/estrategias" element={
        <Layout>
          <ErrorBoundary fallbackLabel="Erro nas Estratégias">
            <React.Suspense fallback={<PageLoader />}>
              <EstrategiasPage />
            </React.Suspense>
          </ErrorBoundary>
        </Layout>
      } />

      <Route path="/configuracoes" element={
        <Layout>
          <ErrorBoundary fallbackLabel="Erro nas Configurações">
            <React.Suspense fallback={<PageLoader />}>
              <ConfigPage />
            </React.Suspense>
          </ErrorBoundary>
        </Layout>
      } />

      {/* Redirecionar rotas desconhecidas */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
