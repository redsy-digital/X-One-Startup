import { logger } from "./logger";

/**
 * Deriv API Service — New API (api.derivws.com)
 * Autenticação: PAT → REST accounts → OTP → WebSocket
 *
 * Gestão de conexão baseada em "epoch" para evitar race conditions:
 * cada tentativa de conexão tem um ID único; tentativas obsoletas são ignoradas.
 */

const DERIV_REST_BASE = "https://api.derivws.com";

export type DerivMessage = { msg_type: string; [key: string]: any };

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
  private readonly MAX_RECONNECT = 5;

  // Epoch: garante que apenas a conexão mais recente processa eventos
  private _epoch = 0;

  constructor(appId: string = import.meta.env.VITE_DERIV_APP_ID || "1089") {
    this.appId = appId;
  }

  // ── API pública ───────────────────────────────────────────────────────────

  setToken(token: string, isDemo: boolean = true) {
    this.pat = token;
    this.isDemo = isDemo;
  }

  connect(accountId?: string, isDemo?: boolean) {
    if (accountId) this.activeAccountId = accountId;
    if (isDemo !== undefined) this.isDemo = isDemo;
    this.isIntentionallyDisconnected = false;

    if (!this.pat) {
      console.error("[Deriv] No PAT — call setToken() first.");
      return;
    }

    if (!this.activeAccountId) {
      this._fetchAndConnect();
    } else {
      this._connectViaOTP(this.activeAccountId);
    }
  }

  disconnect() {
    this.isIntentionallyDisconnected = true;
    this._epoch++; // invalida todas as tentativas em curso
    this._clearReconnectTimer();
    this._closeSocket();
    this.reconnectAttempts = 0;
  }

  send(data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn("[Deriv] Cannot send — socket not open:", Object.keys(data)[0]);
    }
  }

  on(type: string, callback: (data: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }

  subscribeTicks(symbol: string) {
    this.send({ ticks: symbol, subscribe: 1 });
  }

  unsubscribeTicks(_symbol: string) {
    this.send({ forget_all: "ticks" });
  }

  /**
   * Pede candles históricos via ticks_history (style: "candles").
   * subscribe:0 → pedido único, não inicia stream (a stream de ticks ao
   * vivo já é gerida separadamente por subscribeTicks).
   * Resposta chega com msg_type "candles" — ouvir via derivService.on("candles", ...).
   */
  requestTicksHistory(symbol: string, count: number, granularitySeconds: number) {
    this.send({
      ticks_history: symbol,
      end: "latest",
      count,
      style: "candles",
      granularity: granularitySeconds,
      adjust_start_time: 1,
      subscribe: 0,
    });
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
      underlying_symbol: symbol,  // renamed from "symbol" in new Deriv API
    });
  }

  buy(proposalId: string, price: number) {
    this.send({ buy: proposalId, price });
  }

  subscribeProposalOpenContract() {
    this.send({ proposal_open_contract: 1, subscribe: 1 });
  }

  async fetchAccounts(): Promise<any[]> {
    if (!this.pat) throw new Error("[Deriv] No PAT set");

    const res = await fetch(`${DERIV_REST_BASE}/trading/v1/options/accounts`, {
      headers: {
        Authorization: `Bearer ${this.pat}`,
        "Deriv-App-ID": this.appId,
      },
    });

    if (!res.ok) throw new Error(`fetchAccounts failed: ${res.status}`);
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private async _fetchAndConnect() {
    const epoch = ++this._epoch;
    try {
      const accounts = await this.fetchAccounts();
      if (epoch !== this._epoch) return; // superseded
      if (!accounts.length) { this._emitAuthError("Nenhuma conta encontrada."); return; }
      const demo = accounts.find((a) => this._isDemo(a)) ?? accounts[0];
      this.activeAccountId = demo.account_id;
      this.isDemo = this._isDemo(demo);
      this._connectViaOTP(this.activeAccountId);
    } catch (e: any) {
      if (epoch === this._epoch) this._emitAuthError(e.message);
    }
  }

  private async _connectViaOTP(accountId: string) {
    const epoch = ++this._epoch; // nova epoch — invalida qualquer tentativa anterior

    this._clearReconnectTimer();
    this._closeSocket(); // fecha socket ANTERIOR sem disparar reconnect (handlers já removidos)

    try {
      logger.system(`Conectando à Deriv... conta: ${accountId}`);
      console.log(`[Deriv] Getting OTP for ${accountId} (epoch ${epoch})`);
      const wsUrl = await this._getOTPUrl(accountId);

      if (epoch !== this._epoch) {
        console.log(`[Deriv] Stale attempt epoch ${epoch}, aborting`);
        return; // foi superseded enquanto aguardava OTP
      }

      this.socket = new WebSocket(wsUrl);
      this._setupHandlers(accountId, epoch);
    } catch (e: any) {
      console.error(`[Deriv] OTP error (epoch ${epoch}):`, e.message);
      if (epoch === this._epoch) {
        this._emitAuthError(e.message);
        this._scheduleReconnect(epoch);
      }
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
    if (!res.ok) throw new Error(`OTP failed: ${res.status}`);
    const json = await res.json();
    const url = json.data?.url ?? json.url;
    if (!url) throw new Error("OTP response missing WebSocket URL");
    return url;
  }

  private _setupHandlers(accountId: string, epoch: number) {
    if (!this.socket) return;

    this.socket.onopen = async () => {
      if (epoch !== this._epoch) return;
      console.log(`[Deriv] Connected (epoch ${epoch})`);
      this.reconnectAttempts = 0;

      try {
        const accounts = await this.fetchAccounts();
        if (epoch !== this._epoch) return;
        const account = accounts.find((a) => a.account_id === accountId) ?? accounts[0];
        const balance = Number(account?.balance ?? 0);
        const accountType = this._isDemo(account) ? "Demo" : "Real";
        logger.system(`✓ Autorizado | ${accountId} [${accountType}] | Saldo: $${balance.toFixed(2)}`);
        this._emit("authorize", {
          authorize: {
            balance,
            loginid: account?.account_id ?? accountId,
            currency: account?.currency ?? "USD",
            is_virtual: this._isDemo(account) ? 1 : 0,
          },
        });
      } catch {
        if (epoch !== this._epoch) return;
        logger.system(`✓ Autorizado | ${accountId} | (saldo não disponível)`);
        this._emit("authorize", {
          authorize: { balance: 0, loginid: accountId, currency: "USD", is_virtual: this.isDemo ? 1 : 0 },
        });
      }
    };

    this.socket.onmessage = (event) => {
      if (epoch !== this._epoch) return;
      try {
        const data = JSON.parse(event.data) as DerivMessage;
        if (data.msg_type) this._emit(data.msg_type, data);
      } catch (e) {
        console.error("[Deriv] Parse error:", e);
      }
    };

    this.socket.onerror = () => {
      if (epoch !== this._epoch) return;
      console.error("[Deriv] WebSocket error");
    };

    this.socket.onclose = (event) => {
      if (epoch !== this._epoch) return; // ignorar close de socket antigo
      console.log(`[Deriv] Closed (code ${event.code}, epoch ${epoch})`);
      if (!this.isIntentionallyDisconnected) logger.system(`WebSocket desconectado (code ${event.code}) — a reconectar...`);
      if (!this.isIntentionallyDisconnected) this._scheduleReconnect(epoch);
    };
  }

  private _closeSocket() {
    if (!this.socket) return;
    // Remove handlers ANTES de fechar para não disparar _scheduleReconnect
    this.socket.onopen = null;
    this.socket.onmessage = null;
    this.socket.onerror = null;
    this.socket.onclose = null;
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
    this.socket = null;
  }

  private _scheduleReconnect(epoch: number) {
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      console.warn("[Deriv] Max reconnect attempts reached");
      return;
    }
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(`[Deriv] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      if (epoch !== this._epoch) return; // superseded por nova conexão
      if (!this.isIntentionallyDisconnected && this.activeAccountId) {
        this._connectViaOTP(this.activeAccountId);
      }
    }, delay);
  }

  private _clearReconnectTimer() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private _emit(type: string, data: any) {
    this.listeners.get(type)?.forEach((cb) => cb(data));
  }

  private _emitAuthError(message: string) {
    logger.error(`Erro de autorização: ${message}`);
    this._emit("authorize", { error: { code: "AuthError", message } });
  }

  private _isDemo(account: any): boolean {
    if (!account) return true;
    if (account.account_type === "demo") return true;
    if (account.is_virtual === true || account.is_virtual === 1) return true;
    const id = String(account.account_id ?? "").toUpperCase();
    return id.startsWith("VRT") || id.startsWith("DEMO");
  }
}

export const derivService = new DerivService();
