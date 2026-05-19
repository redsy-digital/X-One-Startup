import { create } from "zustand";
import { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { derivService } from "../lib/deriv";
import { DerivAccount } from "../lib/derivOAuth";

// ── Estado ────────────────────────────────────────────────────────────────────

interface ConnectionState {
  // Supabase Auth
  supabaseUser: User | null;
  authLoading: boolean;

  // Deriv connection
  derivAccounts: DerivAccount[];
  activeAccount: DerivAccount | null;
  isDemo: boolean;
  isAuthorized: boolean;
  derivTokenExpired: boolean;
  derivLoading: boolean;
  derivError: string | null;

  // Legado (compatibilidade com hooks)
  token: string;
  isLoggedIn: boolean;
  balance: number | null;

  // Actions — Auth Supabase
  initAuth: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

  // Actions — Deriv PAT
  connectWithPAT: (pat: string) => Promise<string | null>;
  switchAccount: (isDemo: boolean) => void;
  disconnectDeriv: () => Promise<void>;

  // Setters
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
  derivError: null,

  // Legado
  token: "",
  isLoggedIn: false,
  balance: null,

  // ── Inicialização ─────────────────────────────────────────────────────────

  initAuth: async () => {
    set({ authLoading: true });

    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      set({ supabaseUser: session.user, isLoggedIn: true, authLoading: false });
      await _loadDerivConnection(set);
    } else {
      set({ authLoading: false });
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        set({ supabaseUser: session.user, isLoggedIn: true });
        await _loadDerivConnection(set);
      } else if (event === "SIGNED_OUT") {
        derivService.disconnect();
        set({
          supabaseUser: null, isLoggedIn: false, isAuthorized: false,
          token: "", balance: null, derivAccounts: [], activeAccount: null,
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
  },

  // ── Deriv PAT ─────────────────────────────────────────────────────────────

  connectWithPAT: async (pat: string) => {
    const { supabaseUser } = get();
    if (!supabaseUser) return "Utilizador não autenticado.";

    set({ derivLoading: true, derivError: null });

    try {
      // 1. Buscar contas via REST
      derivService.setToken(pat);
      const rawAccounts = await derivService.fetchAccounts();

      if (!rawAccounts || rawAccounts.length === 0) {
        set({ derivLoading: false, derivError: "Nenhuma conta encontrada para este token." });
        return "Nenhuma conta encontrada para este token.";
      }

      // 2. Normalizar contas → DerivAccount[]
      const accounts: DerivAccount[] = rawAccounts.map((a: any) => ({
        account_id: a.account_id,
        token: pat, // PAT é o mesmo para todas as contas
        currency: a.currency ?? "USD",
        is_demo:
          a.account_type === "demo" ||
          a.is_virtual === true ||
          a.is_virtual === 1 ||
          String(a.account_id ?? "").toUpperCase().startsWith("VRT"),
      }));

      // 3. Conta activa: demo preferida
      const demoAccount = accounts.find((a) => a.is_demo) ?? accounts[0];

      // 4. Guardar no Supabase
      await supabase.from("deriv_connections").upsert(
        {
          user_id: supabaseUser.id,
          account_id: demoAccount.account_id,
          token: pat, // token = PAT (encriptado no Supabase)
          currency: demoAccount.currency,
          is_demo: demoAccount.is_demo,
          accounts: accounts,
          last_used_at: new Date().toISOString(),
          is_active: true,
        },
        { onConflict: "user_id" }
      );

      // 5. Actualizar store
      set({
        derivAccounts: accounts,
        activeAccount: demoAccount,
        isDemo: demoAccount.is_demo,
        token: pat,
      });

      // 6. Conectar WebSocket via OTP
      derivService.connect(demoAccount.account_id, demoAccount.is_demo);

      return null; // sem erro
    } catch (e: any) {
      const msg = e.message || "Erro ao conectar à Deriv.";
      set({ derivLoading: false, derivError: msg });
      return msg;
    }
  },

  // ── Troca Demo ↔ Real ─────────────────────────────────────────────────────

  switchAccount: (isDemo: boolean) => {
    const { derivAccounts, token } = get();
    const target = derivAccounts.find((a) => a.is_demo === isDemo);

    if (!target) {
      console.warn("[ConnectionStore] Conta não encontrada para isDemo:", isDemo);
      return;
    }

    set({
      activeAccount: target,
      isDemo: target.is_demo,
      isAuthorized: false,
      balance: null,
    });

    // Reconecta com o mesmo PAT mas para outra conta (novo OTP)
    derivService.setToken(token, target.is_demo);
    derivService.connect(target.account_id, target.is_demo);
  },

  // ── Desconectar ───────────────────────────────────────────────────────────

  disconnectDeriv: async () => {
    const { supabaseUser } = get();

    derivService.disconnect();
    set({
      derivAccounts: [], activeAccount: null,
      isAuthorized: false, token: "", balance: null,
      derivTokenExpired: false, derivError: null,
    });

    if (supabaseUser) {
      await supabase
        .from("deriv_connections")
        .delete()
        .eq("user_id", supabaseUser.id);
    }
  },

  // ── Setters ───────────────────────────────────────────────────────────────

  setIsAuthorized: (val) => set({ isAuthorized: val }),
  setBalance: (val) => set({ balance: val }),
  setDerivTokenExpired: (val) => set({ derivTokenExpired: val }),
  setIsLoggedIn: (val) => set({ isLoggedIn: val }),
  setIsDemo: (val) => get().switchAccount(val),
  setToken: (val) => set({ token: val }),
}));

// ── Helper: carrega conexão Deriv guardada no Supabase ────────────────────────

async function _loadDerivConnection(set: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await supabase
    .from("deriv_connections")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (error || !data) return;

  const accounts: DerivAccount[] = data.accounts ?? [{
    account_id: data.account_id,
    token: data.token,
    currency: data.currency,
    is_demo: data.is_demo,
  }];

  const active = accounts.find((a) => a.is_demo === data.is_demo) ?? accounts[0];
  const pat = data.token;

  set({
    derivAccounts: accounts,
    activeAccount: active,
    isDemo: active.is_demo,
    token: pat,
  });

  // Reconecta automaticamente
  derivService.setToken(pat, active.is_demo);
  derivService.connect(active.account_id, active.is_demo);
}
