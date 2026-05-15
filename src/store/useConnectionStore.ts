import { create } from "zustand";
import { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { derivService } from "../lib/deriv";
import {
  buildDerivOAuthUrl,
  parseDerivOAuthCallback,
  hasDerivOAuthCallback,
  clearOAuthParams,
  DerivAccount,
} from "../lib/derivOAuth";

// ── Estado ────────────────────────────────────────────────────────────────────

interface ConnectionState {
  // Supabase Auth
  supabaseUser: User | null;
  authLoading: boolean;

  // Deriv connection
  derivAccounts: DerivAccount[];      // todas as contas retornadas pelo OAuth
  activeAccount: DerivAccount | null; // conta em uso agora
  isDemo: boolean;
  isAuthorized: boolean;              // WebSocket autenticado com sucesso
  derivTokenExpired: boolean;         // token expirou → mostrar banner
  derivLoading: boolean;              // a carregar conexão Deriv

  // Legado (mantidos para compatibilidade com hooks existentes)
  token: string;
  isLoggedIn: boolean;
  balance: number | null;

  // Actions — Auth
  initAuth: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

  // Actions — Deriv
  connectDeriv: () => void;           // inicia OAuth redirect
  handleOAuthCallback: () => Promise<void>; // processa callback da Deriv
  switchAccount: (isDemo: boolean) => void; // troca Demo ↔ Real
  disconnectDeriv: () => Promise<void>;     // remove conexão Deriv

  // Actions — Estado
  setIsAuthorized: (val: boolean) => void;
  setBalance: (val: number | null) => void;
  setDerivTokenExpired: (val: boolean) => void;
  setIsLoggedIn: (val: boolean) => void;
  setIsDemo: (val: boolean) => void;
  setToken: (val: string) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  supabaseUser: null,
  authLoading: true,
  derivAccounts: [],
  activeAccount: null,
  isDemo: true,
  isAuthorized: false,
  derivTokenExpired: false,
  derivLoading: false,

  // Legado
  token: "",
  isLoggedIn: false,
  balance: null,

  // ── Inicialização ─────────────────────────────────────────────────────────

  initAuth: async () => {
    set({ authLoading: true });

    // 1. Verificar sessão Supabase existente
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      set({
        supabaseUser: session.user,
        isLoggedIn: true,
        authLoading: false,
      });

      // 2. Verificar callback OAuth da Deriv (URL com ?acct1=...)
      if (hasDerivOAuthCallback()) {
        await get().handleOAuthCallback();
        return;
      }

      // 3. Carregar conexão Deriv existente do Supabase
      await loadDerivConnection(set);
    } else {
      set({ authLoading: false });
    }

    // 4. Subscrever a mudanças de sessão Supabase
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        set({ supabaseUser: session.user, isLoggedIn: true });
        await loadDerivConnection(set);
      } else if (event === "SIGNED_OUT") {
        derivService.disconnect();
        set({
          supabaseUser: null,
          isLoggedIn: false,
          isAuthorized: false,
          token: "",
          balance: null,
          derivAccounts: [],
          activeAccount: null,
        });
      }
    });
  },

  // ── Supabase Auth ─────────────────────────────────────────────────────────

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return error ? error.message : null;
  },

  signOut: async () => {
    derivService.disconnect();
    await supabase.auth.signOut();
    // Estado limpo via onAuthStateChange
  },

  // ── Deriv OAuth ───────────────────────────────────────────────────────────

  connectDeriv: () => {
    window.location.href = buildDerivOAuthUrl();
  },

  handleOAuthCallback: async () => {
    const { supabaseUser } = get();
    if (!supabaseUser) return;

    set({ derivLoading: true });

    const accounts = parseDerivOAuthCallback();
    clearOAuthParams();

    if (accounts.length === 0) {
      set({ derivLoading: false });
      return;
    }

    // Conta demo é a principal por defeito; se não existir, usa a primeira
    const demoAccount = accounts.find((a) => a.is_demo) ?? accounts[0];
    const realAccount = accounts.find((a) => !a.is_demo) ?? null;
    const primaryAccount = demoAccount;

    // Guardar no Supabase
    const { error } = await supabase.from("deriv_connections").upsert(
      {
        user_id: supabaseUser.id,
        account_id: primaryAccount.account_id,
        token: primaryAccount.token,
        currency: primaryAccount.currency,
        is_demo: primaryAccount.is_demo,
        accounts: accounts,
        last_used_at: new Date().toISOString(),
        is_active: true,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error("[ConnectionStore] Error saving Deriv connection:", error.message);
      set({ derivLoading: false });
      return;
    }

    set({
      derivAccounts: accounts,
      activeAccount: primaryAccount,
      isDemo: primaryAccount.is_demo,
      token: primaryAccount.token,
    });

    connectWebSocket(primaryAccount.token, set);
  },

  // ── Troca Demo ↔ Real ─────────────────────────────────────────────────────

  switchAccount: (isDemo) => {
    const { derivAccounts } = get();
    const target = derivAccounts.find((a) => a.is_demo === isDemo);

    if (!target) {
      console.warn("[ConnectionStore] No account found for isDemo:", isDemo);
      return;
    }

    set({
      activeAccount: target,
      isDemo: target.is_demo,
      token: target.token,
      isAuthorized: false,
      balance: null,
    });

    // Reconectar WebSocket com novo token (sem novo OAuth)
    derivService.setToken(target.token, target.is_demo);
    if (!derivService["socket"] || derivService["socket"].readyState !== WebSocket.OPEN) {
      derivService.connect();
    }
  },

  // ── Desconectar Deriv ─────────────────────────────────────────────────────

  disconnectDeriv: async () => {
    const { supabaseUser } = get();

    derivService.disconnect();
    set({
      derivAccounts: [],
      activeAccount: null,
      isAuthorized: false,
      token: "",
      balance: null,
      derivTokenExpired: false,
    });

    if (supabaseUser) {
      await supabase
        .from("deriv_connections")
        .delete()
        .eq("user_id", supabaseUser.id);
    }
  },

  // ── Setters simples ───────────────────────────────────────────────────────

  setIsAuthorized: (val) => set({ isAuthorized: val }),
  setBalance: (val) => set({ balance: val }),
  setDerivTokenExpired: (val) => set({ derivTokenExpired: val }),
  setIsLoggedIn: (val) => set({ isLoggedIn: val }),
  setIsDemo: (val) => {
    // Mantido para compatibilidade — usa switchAccount internamente
    get().switchAccount(val);
  },
  setToken: (val) => set({ token: val }),
}));

// ── Helpers privados ──────────────────────────────────────────────────────────

async function loadDerivConnection(set: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await supabase
    .from("deriv_connections")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (error || !data) return; // sem conexão guardada

  const accounts: DerivAccount[] = data.accounts ?? [
    {
      account_id: data.account_id,
      token: data.token,
      currency: data.currency,
      is_demo: data.is_demo,
    },
  ];

  // Restaurar a conta que estava ativa (demo por defeito)
  const activeAccount = accounts.find((a) => a.is_demo === data.is_demo) ?? accounts[0];

  set({
    derivAccounts: accounts,
    activeAccount,
    isDemo: activeAccount.is_demo,
    token: activeAccount.token,
  });

  connectWebSocket(activeAccount.token, set);
}

function connectWebSocket(token: string, set: any) {
  derivService.setToken(token, true);
  derivService.connect();

  // Detetar token expirado via erro de autorização
  const unsubAuth = derivService.on("authorize", (data: any) => {
    if (data.error) {
      const msg: string = data.error.message || "";
      const isExpired =
        msg.toLowerCase().includes("invalid token") ||
        msg.toLowerCase().includes("expired") ||
        msg.toLowerCase().includes("InvalidToken");

      if (isExpired) {
        set({ derivTokenExpired: true, isAuthorized: false });
      }
    } else {
      set({ isAuthorized: true, derivTokenExpired: false, derivLoading: false });
    }
    unsubAuth();
  });
}
