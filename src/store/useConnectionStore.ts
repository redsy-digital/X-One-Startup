import { create } from "zustand";
import { derivService } from "../lib/deriv";

interface ConnectionState {
  // Auth
  token: string;
  isLoggedIn: boolean;
  isAuthorized: boolean;

  // Account
  balance: number | null;
  isDemo: boolean;

  // Actions
  setToken: (token: string) => void;
  setIsLoggedIn: (val: boolean) => void;
  setIsAuthorized: (val: boolean) => void;
  setBalance: (val: number | null) => void;
  setIsDemo: (val: boolean) => void;

  login: (token: string, isDemo: boolean) => void;
  logout: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  token: localStorage.getItem("deriv_token") || "",
  isLoggedIn: false,
  isAuthorized: false,
  balance: null,
  isDemo: true,

  setToken: (token) => set({ token }),
  setIsLoggedIn: (val) => set({ isLoggedIn: val }),
  setIsAuthorized: (val) => set({ isAuthorized: val }),
  setBalance: (val) => set({ balance: val }),
  setIsDemo: (val) => {
    set({ isDemo: val });
    const { token, isLoggedIn } = get();
    if (isLoggedIn && token) {
      derivService.setToken(token, val);
    }
  },

  login: (token, isDemo) => {
    if (!token) return;
    localStorage.setItem("deriv_token", token);
    set({ token });
    derivService.setToken(token, isDemo);
    derivService.connect();
  },

  logout: () => {
    localStorage.removeItem("deriv_token");
    set({ isLoggedIn: false, isAuthorized: false, token: "", balance: null });
    derivService.disconnect();
    window.location.reload();
  },
}));
