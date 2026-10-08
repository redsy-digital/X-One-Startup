import React, { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Loader2, Mail, Lock, LogIn, UserPlus, ShieldCheck, Link2, Loader } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { NeonCard } from "./components/NeonCard";
import { Layout } from "./components/Layout";
import { TradingEngineRunner } from "./components/TradingEngineRunner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { derivService } from "./lib/deriv";
import { logger } from "./lib/logger";
import { useConnectionStore, useBotStore, useMarketStore, useHistoryStore, useSettingsStore } from "./store";
import { forexMarketDataService } from "./forex/market-data";
import { buildDerivOAuthUrl, clearDerivOAuthState, exchangeDerivOAuthCode, getStoredCodeVerifier, getStoredOAuthState } from "./lib/derivOAuth";

// ── Lazy page imports ─────────────────────────────────────────────────────────
const HomePage       = React.lazy(() => import("./pages/HomePage").then(m => ({ default: m.HomePage })));
const DashboardPage  = React.lazy(() => import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const HistoricoPage  = React.lazy(() => import("./pages/HistoricoPage").then(m => ({ default: m.HistoricoPage })));
const LogsPage       = React.lazy(() => import("./pages/LogsPage").then(m => ({ default: m.LogsPage })));
const EstrategiasPage = React.lazy(() => import("./pages/EstrategiasPage").then(m => ({ default: m.EstrategiasPage })));
const ConfigPage     = React.lazy(() => import("./pages/ConfigPage").then(m => ({ default: m.ConfigPage })));
const TestesForexPage = React.lazy(() => import("./pages/TestesForexPage").then(m => ({ default: m.TestesForexPage })));

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

  // Uma conta guardada não garante que o PAT ainda é válido.
  // Só mostramos o selector de mercado depois da autorização real.
  if (!isAuthorized) {
    return <ConnectDerivScreen />;
  }

  return <>{children}</>;
};

// ── Ecrã de conexão Deriv ─────────────────────────────────────────────────────
const ConnectDerivScreen = () => {
  const { derivError, derivLoading, derivTokenExpired } = useConnectionStore();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleOAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = await buildDerivOAuthUrl();
      window.location.assign(url);
    } catch (e: any) {
      setError(e?.message || "Não foi possível iniciar a autorização Deriv.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <NeonCard variant="blue" className="p-8 space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-400" />
              {derivTokenExpired ? "Sessão Deriv expirada" : "Conectar à Deriv"}
            </h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {derivTokenExpired
                ? "A autorização anterior expirou ou foi recusada. Autoriza novamente a tua conta Deriv."
                : "Liga a tua conta Deriv através do OAuth 2.0 oficial. O X-One solicitará apenas a permissão de trading necessária."}
            </p>
          </div>

          {(error || derivError) && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400 font-bold">
              {error || derivError}
            </div>
          )}

          <Button
            onClick={handleOAuth}
            disabled={loading || derivLoading}
            className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 font-black uppercase tracking-widest disabled:opacity-50"
          >
            {loading || derivLoading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <><Link2 className="w-5 h-5 mr-2" /> Autorizar com a Deriv</>}
          </Button>

          <p className="text-[10px] text-center text-muted-foreground leading-relaxed">
            Será aberta a página oficial da Deriv para iniciares sessão e autorizares o X-One.
          </p>
        </NeonCard>
      </div>
    </div>
  );
};

// ── Callback OAuth 2.0 + PKCE ────────────────────────────────────────────────
const DerivOAuthCallbackPage = () => {
  const navigate = useNavigate();
  const { connectWithOAuthToken } = useConnectionStore();
  const [status, setStatus] = React.useState("A validar a autorização Deriv...");
  const [error, setError] = React.useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const finishOAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const returnedState = params.get("state");
      const oauthError = params.get("error");
      const expectedState = getStoredOAuthState();
      const codeVerifier = getStoredCodeVerifier();

      if (oauthError) throw new Error(params.get("error_description") || `Autorização Deriv recusada: ${oauthError}`);
      if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
        throw new Error("Validação OAuth falhou: state inválido ou autorização incompleta.");
      }
      if (!codeVerifier) throw new Error("Sessão PKCE perdida. Inicia novamente a autorização Deriv.");

      setStatus("A trocar o código OAuth por uma sessão segura...");
      const accessToken = await exchangeDerivOAuthCode(code, codeVerifier);
      clearDerivOAuthState();

      if (cancelled) return;
      setStatus("A ligar a conta Deriv ao X-One...");
      const connectionError = await connectWithOAuthToken(accessToken);
      if (connectionError) throw new Error(connectionError);

      if (!cancelled) navigate("/dashboard", { replace: true });
    };

    finishOAuth().catch((e: any) => {
      if (cancelled) return;
      clearDerivOAuthState();
      setError(e?.message || "Não foi possível concluir a autorização Deriv.");
    });

    return () => { cancelled = true; };
  }, [connectWithOAuthToken, navigate]);

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-4">
      <NeonCard variant="blue" className="w-full max-w-md p-8 space-y-5 text-center">
        {!error && <Loader2 className="w-10 h-10 mx-auto text-blue-400 animate-spin" />}
        <h2 className="text-xl font-bold">{error ? "Falha na autorização" : "A conectar à Deriv"}</h2>
        <p className="text-sm text-muted-foreground">{error || status}</p>
        {error && (
          <Button onClick={() => navigate("/dashboard", { replace: true })} className="w-full">
            Voltar
          </Button>
        )}
      </NeonCard>
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
  const { addTick, setHistoricalCandles, setHistoricalTicks, setHistoricalTicksLoading, setHistoricalTicksError } = useMarketStore();
  const { loadHistory } = useHistoryStore();
  const { loadSettings } = useSettingsStore();

  // Inicializar auth
  useEffect(() => { initAuth(); }, []);

  // Carregar as configurações persistidas, incluindo Digits V1.
  useEffect(() => {
    if (supabaseUser) loadSettings().catch(console.error);
  }, [supabaseUser, loadSettings]);

  // Listeners WebSocket permanentes
  useEffect(() => {
    const unsubTick = derivService.on("tick", (data: any) => {
      if (data.tick) {
        const currentSymbol = useMarketStore.getState().symbol;
        if (String(data.tick.symbol ?? "") !== currentSymbol) return;
        addTick({
          time: Number(data.tick.epoch),
          price: Number(data.tick.quote),
          pipSize: Number.isInteger(Number(data.tick.pip_size)) ? Number(data.tick.pip_size) : undefined,
        });
      }
    });
    const unsubBalance = derivService.on("balance", (data: any) => {
      if (!data.error) setBalance(data.balance.balance);
    });
    const unsubPOC = derivService.on("proposal_open_contract", (data: any) => {
      if (data.proposal_open_contract?.is_sold)
        derivService.send({ balance: 1, subscribe: 1 });
    });
    // Resposta do ticks_history (candles históricos)
    const unsubCandles = derivService.on("candles", (data: any) => {
      // Forex history is loaded through the request/response API below so that
      // each timeframe change is correlated with the exact request that asked
      // for it. The old global listener had no request identity and could let
      // a stale timeframe overwrite the new one. Synthetic markets keep the
      // legacy event-driven path.
      if (useMarketStore.getState().market === "forex") return;
      if (data.error || !data.candles?.length) return;
      const historical = data.candles.map((c: any) => ({
        time: Number(c.epoch),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));
      setHistoricalCandles(historical);
      logger.system(`✓ ${historical.length} candles históricos carregados`);
    });

    const unsubDisconnected = derivService.on("ws_disconnected", (data: any) => {
      useConnectionStore.setState({
        isAuthorized: false,
        balance: null,
      });
      logger.system(`WebSocket Deriv: Desconectado${data?.code ? ` (code ${data.code})` : ""}`);
    });

    const unsubConnected = derivService.on("ws_connected", () => {
      logger.system("WebSocket Deriv: conectado — a aguardar autorização/saldo...");
    });

    const unsubAuth = derivService.on("authorize", (data: any) => {
      if (!data.error) {
        useConnectionStore.setState({
          isAuthorized: true, derivLoading: false,
          derivTokenExpired: false, derivError: null,
        });
        setBalance(data.authorize.balance);
        derivService.subscribeProposalOpenContract();
        derivService.send({ balance: 1, subscribe: 1 });
        logger.system(`✓ Autorização Deriv confirmada | ${data.authorize.loginid}`);
        // O feed inicial é configurado pelo efeito market/symbol/timeframe abaixo.
      } else {
        if (String(data.error.code) === "AUTH_TOKEN_INVALID") {
          useConnectionStore.getState().handleDerivAuthFailure(
            "Token Deriv inválido ou expirado. Insere um novo token para continuar."
          );
        } else {
          useConnectionStore.setState({
            isAuthorized: false, derivLoading: false,
            derivError: data.error.message || "Falha na autorização Deriv.",
          });
          logger.error(`Auth Deriv: ${data.error.message || "Falha na autorização."}`);
        }
      }
    });

    return () => { unsubTick(); unsubBalance(); unsubPOC(); unsubCandles(); unsubAuth(); unsubDisconnected(); unsubConnected(); };
  }, []);

  // Feed de mercado — derivado do mercado/símbolo/timeframe actual.
  // Forex usa frxEURUSD + M1 por defeito nesta Fase 2; continua sem execução.
  // Em Synthetic/Digits o timeframe das velas é local e não deve provocar
  // novo pedido dos mesmos 1.000 ticks; apenas o Forex depende dele para
  // escolher o histórico remoto.
  const { market, symbol, timeframe } = useMarketStore();
  const marketHistoryKey = market === "forex" ? timeframe : 0;
  const forexHistoryRequestRef = React.useRef(0);
  useEffect(() => {
    if (!isAuthorized || !market) return;

    const requestEpoch = ++forexHistoryRequestRef.current;
    setHistoricalTicksError(null);
    setHistoricalTicksLoading(market !== "forex");
    derivService.unsubscribeTicks(symbol);
    derivService.subscribeTicks(symbol);

    if (market === "forex") {
      // IMPORTANT: never wait for live ticks to build a new timeframe.
      // Fetch a full historical dataset first, then let the tick stream update
      // only the last/open candle. A stale request is ignored if the user
      // changes timeframe again before the response arrives.
      const timeframeMinutes = Math.max(1, Math.round(timeframe / 60));
      forexMarketDataService.loadHistoricalCandles("frxEURUSD", timeframeMinutes, 500)
        .then((historical) => {
          if (requestEpoch !== forexHistoryRequestRef.current) return;
          useMarketStore.getState().setHistoricalCandles(historical);
          logger.system(`✓ Forex | ${historical.length} candles históricos carregados | M${timeframeMinutes}`);
        })
        .catch((error: any) => {
          if (requestEpoch !== forexHistoryRequestRef.current) return;
          logger.error(`Forex histórico M${timeframeMinutes}: ${error?.message || error}`);
        });

      derivService.getActiveSymbols(["CALL", "PUT"])
        .then((symbols) => {
          const eurusd = symbols.find((item: any) => item.underlying_symbol === "frxEURUSD");
          if (eurusd) logger.system(`✓ New API | Forex ${eurusd.underlying_symbol_name} | pip_size=${eurusd.pip_size} | open=${eurusd.exchange_is_open}`);
          else logger.error("New API: frxEURUSD não apareceu em active_symbols.");
        })
        .catch((error: any) => logger.error(`New API active_symbols: ${error.message}`));
      derivService.getContractsFor("frxEURUSD")
        .then((result) => {
          const contracts = (result.available ?? []).map((c: any) => c.contract_type).filter(Boolean);
          logger.system(`✓ New API | frxEURUSD contracts_for: ${contracts.join(", ") || "nenhum"}`);
        })
        .catch((error: any) => logger.error(`New API contracts_for: ${error.message}`));
    } else {
      // Digits: o gráfico começa com 1000 ticks históricos e continua a
      // receber apenas os novos ticks da subscrição em tempo real.
      derivService.getRawTicksHistory(symbol, 1000, "latest")
        .then(({ times, prices }) => {
          if (requestEpoch !== forexHistoryRequestRef.current) return;
          const historical = times.map((time, i) => ({ time, price: Number(prices[i]) }))
            .filter((tick) => Number.isFinite(tick.time) && Number.isFinite(tick.price));
          setHistoricalTicks(historical, useMarketStore.getState().timeframe);
          logger.system(`✓ Digits | ${historical.length} ticks históricos carregados | ${symbol}`);
        })
        .catch((error: any) => {
          if (requestEpoch !== forexHistoryRequestRef.current) return;
          const message = error?.message || String(error);
          setHistoricalTicksError(message);
          logger.error(`Digits histórico ${symbol}: ${message}`);
        });
    }

    return () => {
      if (market === "forex") forexHistoryRequestRef.current++;
      derivService.unsubscribeTicks(symbol);
    };
  }, [isAuthorized, market, symbol, marketHistoryKey]);

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
      {/* Motor de trading sempre montado quando autorizado — sem UI fantasma,
          bot opera em qualquer página (Fix #7 da auditoria) */}
      {isAuthorized && (
        <ErrorBoundary fallbackLabel="">
          <TradingEngineRunner />
        </ErrorBoundary>
      )}
      <Routes>
      <Route path="/oauth/callback" element={<DerivOAuthCallbackPage />} />

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

      <Route path="/testes-forex" element={
        <Layout>
          <DerivGuard>
            <ErrorBoundary fallbackLabel="Erro nos Testes Forex">
              <React.Suspense fallback={<PageLoader />}>
                <TestesForexPage />
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
