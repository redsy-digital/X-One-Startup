/**
 * Deriv API Service — New API (api.derivws.com)
 * Autenticação: PAT → REST accounts → OTP → WebSocket
 * API pública mantida idêntica à versão anterior.
 */

const DERIV_REST_BASE = "https://api.derivws.com";

export type DerivMessage = {
  msg_type: string;
  [key: string]: any;
};

export class DerivService {
  private socket: WebSocket | null = null;
  private appId: string;
  private pat: string | null = null;
  private activeAccountId: string | null = null;
  private isDemo: boolean = true;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private isIntentionallyDisconnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  constructor(appId: string = import.meta.env.VITE_DERIV_APP_ID || "1089") {
    this.appId = appId;
  }

  // ── API pública — compatível com versão anterior ──────────────────────────

  /**
   * Guarda o PAT e (opcionalmente) o accountId para conexão.
   * Mantido para compatibilidade com useConnectionStore.
   */
  setToken(token: string, isDemo: boolean = true) {
    this.pat = token;
    this.isDemo = isDemo;
  }

  /**
   * Conecta ao WebSocket da Deriv via OTP.
   * @param accountId  ID da conta a conectar (ex: "VRTC12345")
   * @param isDemo     Se é conta demo
   */
  connect(accountId?: string, isDemo?: boolean) {
    if (accountId) this.activeAccountId = accountId;
    if (isDemo !== undefined) this.isDemo = isDemo;

    this.isIntentionallyDisconnected = false;

    if (!this.pat) {
      console.error("[DerivService] No PAT token set — call setToken() first.");
      return;
    }

    if (!this.activeAccountId) {
      // Se não há accountId ainda, busca contas primeiro e conecta à demo (ou primeira)
      this._fetchAccountsAndConnect();
      return;
    }

    this._connectViaOTP(this.activeAccountId);
  }

  disconnect() {
    this.isIntentionallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.reconnectAttempts = 0;
  }

  send(data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log(`[DerivService] Sending: ${Object.keys(data)[0]}`);
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn("[DerivService] Cannot send — socket not open:", data);
    }
  }

  on(type: string, callback: (data: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }

  subscribeTicks(symbol: string) {
    this.send({ ticks: symbol, subscribe: 1 });
  }

  unsubscribeTicks(_symbol: string) {
    this.send({ forget_all: "ticks" });
  }

  getPriceProposal(
    symbol: string,
    contractType: "CALL" | "PUT",
    amount: number,
    duration: number,
    durationUnit: string
  ) {
    this.send({
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration,
      duration_unit: durationUnit,
      symbol,
    });
  }

  buy(proposalId: string, price: number) {
    this.send({ buy: proposalId, price });
  }

  subscribeProposalOpenContract() {
    this.send({ proposal_open_contract: 1, subscribe: 1 });
  }

  // ── REST API helpers ──────────────────────────────────────────────────────

  async fetchAccounts(): Promise<any[]> {
    if (!this.pat) throw new Error("[DerivService] No PAT set");

    const res = await fetch(`${DERIV_REST_BASE}/trading/v1/options/accounts`, {
      headers: {
        Authorization: `Bearer ${this.pat}`,
        "Deriv-App-ID": this.appId,
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[DerivService] fetchAccounts failed ${res.status}: ${err}`);
    }

    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private async _fetchAccountsAndConnect() {
    try {
      const accounts = await this.fetchAccounts();
      if (accounts.length === 0) {
        console.error("[DerivService] No accounts found for this PAT.");
        this._emitAuthorizeError("Nenhuma conta encontrada para este token.");
        return;
      }

      // Preferir conta demo; fallback para primeira
      const demo = accounts.find((a) => this._isDemo(a));
      const target = demo ?? accounts[0];
      this.activeAccountId = target.account_id;
      this.isDemo = this._isDemo(target);

      this._connectViaOTP(this.activeAccountId);
    } catch (e: any) {
      console.error("[DerivService] Error fetching accounts:", e.message);
      this._emitAuthorizeError(e.message);
    }
  }

  private async _connectViaOTP(accountId: string) {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      this.socket.close();
    }

    try {
      const wsUrl = await this._getOTPUrl(accountId);
      console.log(`[DerivService] Connecting via OTP to account: ${accountId}`);
      this.socket = new WebSocket(wsUrl);
      this._setupHandlers(accountId);
    } catch (e: any) {
      console.error("[DerivService] OTP error:", e.message);
      this._emitAuthorizeError(e.message);
      this._scheduleReconnect();
    }
  }

  private async _getOTPUrl(accountId: string): Promise<string> {
    const res = await fetch(
      `${DERIV_REST_BASE}/trading/v1/options/accounts/${accountId}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.pat}`,
          "Deriv-App-ID": this.appId,
        },
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OTP request failed ${res.status}: ${err}`);
    }

    const json = await res.json();
    const url = json.data?.url || json.url;
    if (!url) throw new Error("OTP response missing WebSocket URL");
    return url;
  }

  private _setupHandlers(accountId: string) {
    if (!this.socket) return;

    this.socket.onopen = async () => {
      console.log(`[DerivService] Connected to account: ${accountId}`);
      this.reconnectAttempts = 0;

      // Busca saldo via REST para emitir evento authorize sintético
      // (na nova API não há mensagem {authorize: token} — o OTP já autentica)
      try {
        const accounts = await this.fetchAccounts();
        const account = accounts.find((a) => a.account_id === accountId) ?? accounts[0];

        this._emit("authorize", {
          authorize: {
            balance: Number(account?.balance ?? 0),
            loginid: account?.account_id ?? accountId,
            currency: account?.currency ?? "USD",
            is_virtual: this._isDemo(account) ? 1 : 0,
          },
        });
      } catch {
        // Emite mesmo sem saldo — App.tsx marca como autorizado
        this._emit("authorize", {
          authorize: { balance: 0, loginid: accountId, currency: "USD", is_virtual: this.isDemo ? 1 : 0 },
        });
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DerivMessage;
        const type = data.msg_type;
        if (type) this._emit(type, data);
      } catch (e) {
        console.error("[DerivService] Message parse error:", e);
      }
    };

    this.socket.onerror = (err) => {
      console.error("[DerivService] WebSocket error:", err);
    };

    this.socket.onclose = (event) => {
      console.log(`[DerivService] Closed (code: ${event.code})`);
      if (!this.isIntentionallyDisconnected) {
        this._scheduleReconnect();
      }
    };
  }

  private _scheduleReconnect() {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.warn("[DerivService] Max reconnect attempts reached.");
      return;
    }

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[DerivService] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isIntentionallyDisconnected && this.activeAccountId) {
        this._connectViaOTP(this.activeAccountId);
      }
    }, delay);
  }

  private _emit(type: string, data: any) {
    this.listeners.get(type)?.forEach((cb) => cb(data));
    this.listeners.get("*")?.forEach((cb) => cb(data));
  }

  private _emitAuthorizeError(message: string) {
    this._emit("authorize", {
      error: { code: "AuthError", message },
    });
  }

  private _isDemo(account: any): boolean {
    if (!account) return true;
    if (account.account_type === "demo") return true;
    if (account.is_virtual === true || account.is_virtual === 1) return true;
    const id: string = account.account_id ?? "";
    return id.toUpperCase().startsWith("VRT") || id.toUpperCase().startsWith("DEMO");
  }
}

export const derivService = new DerivService();
