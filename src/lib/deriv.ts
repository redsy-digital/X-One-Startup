import { logger } from "./logger";
import { Candle } from "../types";
import type { DigitsContractType } from "../digits/types";

/**
 * Deriv API Service — New API (api.derivws.com)
 * Autenticação: PAT → REST accounts → OTP → WebSocket
 *
 * Gestão de conexão baseada em "epoch" para evitar race conditions:
 * cada tentativa de conexão tem um ID único; tentativas obsoletas são ignoradas.
 */

const DERIV_REST_BASE = "https://api.derivws.com";

// Public WebSocket app_id used exclusively by the native public economic-calendar
// transport. This is intentionally separate from VITE_DERIV_APP_ID, which belongs
// to the authenticated New API application. Deriv documents 1089 as the public
// testing app_id; production can override it with VITE_DERIV_PUBLIC_APP_ID.
const DERIV_PUBLIC_APP_ID = String(import.meta.env.VITE_DERIV_PUBLIC_APP_ID || "1089");
const DERIV_PUBLIC_WS_BASE = "wss://ws.derivws.com/websockets/v3";

export function buildEconomicCalendarRequest(
  currency?: string,
  startDate?: number,
  endDate?: number,
  req_id?: number
) {
  return {
    economic_calendar: 1,
    ...(currency ? { currency } : {}),
    ...(startDate !== undefined ? { start_date: startDate } : {}),
    ...(endDate !== undefined ? { end_date: endDate } : {}),
    ...(req_id !== undefined ? { req_id } : {}),
  };
}

export type DerivMessage = { msg_type: string; [key: string]: any };

/** Erro de autenticação da credencial PAT na Deriv. */
export class DerivAuthError extends Error {
  readonly status: number;
  readonly code = "AUTH_TOKEN_INVALID" as const;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DerivAuthError";
    this.status = status;
  }
}

function isDerivAuthError(error: unknown): error is DerivAuthError {
  return error instanceof DerivAuthError || (
    typeof error === "object" && error !== null &&
    (error as any).code === "AUTH_TOKEN_INVALID"
  );
}

export class DerivService {
  private socket: WebSocket | null = null;
  private appId: string;
  private pat: string | null = null;
  private activeAccountId: string | null = null;
  private isDemo: boolean = true;
  private accountCurrency: string = "USD";
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private isIntentionallyDisconnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 5;
  private requestSeq = 1000;
  private pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  // Heartbeat / connection health (New API). Deriv recommends a ping every
  // 30–60s to keep WebSocket connections alive through proxies/firewalls.
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInFlight = false;
  private lastMessageAt: number | null = null;
  private lastPingAt: number | null = null;
  private lastPongAt: number | null = null;
  private reconnectCount = 0;

  // Epoch: garante que apenas a conexão mais recente processa eventos
  private _epoch = 0;
  private _debugLogAll = false;

  constructor(appId: string = import.meta.env.VITE_DERIV_APP_ID || "1089") {
    this.appId = appId;
  }

  // ── API pública ───────────────────────────────────────────────────────────

  setToken(token: string, isDemo: boolean = true) {
    this.pat = token;
    this.isDemo = isDemo;
  }

  /** Currency of the currently selected authenticated account (New API). */
  getAccountCurrency(): string {
    return this.accountCurrency;
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
    this._stopHeartbeat();
    this._rejectPendingRequests("Ligação Deriv encerrada.");
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

  /** New API request/response helper. Uses req_id; echo_req is optional in New API. */
  private request<T = any>(payload: Record<string, any>, msgType: string, timeoutMs = 15000): Promise<T> {
    if (!this.isSocketOpen()) return Promise.reject(new Error("WebSocket Deriv não está ligado."));
    const req_id = ++this.requestSeq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(req_id);
        reject(new Error(`Timeout à espera de ${msgType} (req_id ${req_id}).`));
      }, timeoutMs);
      this.pendingRequests.set(req_id, { resolve, reject, timer });
      try {
        this.socket!.send(JSON.stringify({ ...payload, req_id }));
      } catch (error: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(req_id);
        reject(new Error(error?.message || `Falha ao enviar ${msgType} para a Deriv.`));
      }
    });
  }

  /** New API: lista de símbolos activos. */
  async getActiveSymbols(contractType?: string[]) {
    const data = await this.request<any>(
      { active_symbols: "brief", ...(contractType?.length ? { contract_type: contractType } : {}) },
      "active_symbols"
    );
    if (data.error) throw new Error(data.error.message || "Erro em active_symbols");
    return Array.isArray(data.active_symbols) ? data.active_symbols : [];
  }

  /** New API: horários de negociação para todos os símbolos numa data. */
  async getTradingTimes(date: string = "today") {
    const data = await this.request<any>({ trading_times: date }, "trading_times");
    if (data.error) throw new Error(data.error.message || "Erro em trading_times");
    return data.trading_times ?? {};
  }

  /**
   * Deriv-native economic calendar.
   *
   * IMPORTANT:
   * `economic_calendar` is not sent through the authenticated New API trading
   * socket. The X-One uses a separate public WebSocket transport for this
   * request, with an explicit public app_id in the URL. This is the exact
   * pattern validated by the standalone calendar lab.
   *
   * The authenticated New API remains responsible for trading/account data;
   * the public calendar transport is isolated to this method only:
   * trading/authentication/proposals/buy remain entirely on the New API.
   * No third-party calendar source is used.
   */
  async getEconomicCalendar(currency?: string, startDate?: number, endDate?: number) {
    return this.getEconomicCalendarPublic(currency, startDate, endDate);
  }

  private getEconomicCalendarPublic(currency?: string, startDate?: number, endDate?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${DERIV_PUBLIC_WS_BASE}?app_id=${encodeURIComponent(DERIV_PUBLIC_APP_ID)}`;
      logger.system(`[Deriv] Economic calendar public WS: app_id=${DERIV_PUBLIC_APP_ID}`);
      const ws = new WebSocket(wsUrl);
      const reqId = ++this.requestSeq;
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch { /* noop */ }
        fn();
      };

      const timeout = setTimeout(() => {
        finish(() => reject(new Error("Timeout ao consultar o calendário económico nativo da Deriv.")));
      }, 12000);

      ws.onopen = () => {
        ws.send(JSON.stringify(buildEconomicCalendarRequest(currency, startDate, endDate, reqId)));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.req_id !== undefined && Number(data.req_id) !== reqId) return;

          if (data.error) {
            finish(() => reject(new Error(data.error.message || "Erro em economic_calendar")));
            return;
          }

          if (data.msg_type === "economic_calendar") {
            finish(() => resolve(data.economic_calendar ?? { events: [] }));
          }
        } catch (parseError: any) {
          finish(() => reject(new Error(parseError?.message || "Resposta inválida do calendário económico.")));
        }
      };

      ws.onerror = () => {
        finish(() => reject(new Error("Falha na ligação ao calendário económico nativo da Deriv.")));
      };
    });
  }

  /** New API: contratos disponíveis para um símbolo. */
  async getContractsFor(symbol: string) {
    const data = await this.request<any>({ contracts_for: symbol }, "contracts_for");
    if (data.error) throw new Error(data.error.message || "Erro em contracts_for");
    return data.contracts_for ?? { available: [], hit_count: 0 };
  }

  /** New API: proposta de preço sem comprar. Usado apenas para validar capacidades. */
  async probeProposal(
    symbol: string,
    contractType: "CALL" | "PUT" | "HIGHER" | "LOWER",
    amount: number,
    duration: number,
    durationUnit: "s" | "m" | "h" = "m",
    currency = this.accountCurrency,
    barrier?: string
  ) {
    const data = await this.request<any>({
      proposal: 1, amount, basis: "stake", contract_type: contractType, currency,
      duration, duration_unit: durationUnit, underlying_symbol: symbol,
      ...(barrier ? { barrier } : {}),
    }, "proposal");
    if (data.error) throw new Error(data.error.message || "Erro em proposal");
    return data.proposal;
  }

  /** Verifica se o socket está realmente aberto e pronto para enviar pedidos. */
  isSocketOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Snapshot simples do estado da ligação para diagnósticos/UI. */
  getConnectionHealth() {
    return {
      connected: this.isSocketOpen(),
      lastMessageAt: this.lastMessageAt,
      lastPingAt: this.lastPingAt,
      lastPongAt: this.lastPongAt,
      reconnectCount: this.reconnectCount,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Diagnóstico temporário: regista no Logger o msg_type de TODAS as
   * mensagens recebidas durante `ms` milissegundos, depois desliga-se
   * sozinho. Não fica activo para sempre (evitaria encher os Logs
   * durante uso normal, que já não têm limite de buffer).
   */
  debugLogAllMessagesFor(ms: number) {
    this._debugLogAll = true;
    logger.system(`[Debug] A registar todas as mensagens recebidas durante ${ms / 1000}s...`);
    setTimeout(() => {
      this._debugLogAll = false;
      logger.system("[Debug] Registo de todas as mensagens terminado.");
    }, ms);
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
   * Pedido único, sem subscrição (a stream de ticks ao vivo já é gerida
   * separadamente por subscribeTicks). A New API documenta "subscribe"
   * como aceitando SÓ o valor 1 ("Only 1 allowed") — por isso, para um
   * pedido único, o campo é omitido em vez de enviado como 0 (o que a
   * validação mais rígida da New API pode rejeitar ou ignorar em silêncio).
   *
   * IMPORTANTE: a Deriv não aceita granularity < 60 (mínimo 1 minuto)
   * para style "candles" — para timeframes abaixo disso (ex.: os 1HZ,
   * timeframe=1), usar requestRawTicksHistory() em vez desta função.
   *
   * Resposta chega com msg_type "candles" — ouvir via derivService.on("candles", ...).
   * Em caso de erro (ex.: granularity inválida), a resposta vem com
   * msg_type "ticks_history" (o nome do campo do pedido) em vez de "candles".
   */
  /** New API: busca candles históricos como Promise, sem subscrição. */
  async getHistoricalCandles(
    symbol: string,
    count: number,
    granularitySeconds: number,
    end: number | "latest" = "latest"
  ): Promise<Candle[]> {
    const data = await this.request<any>({
      ticks_history: symbol,
      end,
      count,
      style: "candles",
      granularity: granularitySeconds,
      adjust_start_time: 1,
    }, "ticks_history", 20000);
    if (data.error) throw new Error(data.error.message || "Erro em ticks_history");
    if (!Array.isArray(data.candles)) return [];
    return data.candles.map((c: any) => ({
      time: Number(c.epoch),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    })).filter((c: Candle) =>
      Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) &&
      Number.isFinite(c.low) && Number.isFinite(c.close)
    );
  }

  requestTicksHistory(symbol: string, count: number, granularitySeconds: number, end: number | "latest" = "latest") {
    this.send({
      ticks_history: symbol,
      end,
      count,
      style: "candles",
      granularity: granularitySeconds,
      adjust_start_time: 1,
    });
  }

  /**
   * Pede o histórico de TICKS BRUTOS (sem agregação no servidor, sem
   * restrição de granularidade mínima) — para timeframes abaixo de 60s,
   * que a Deriv não aceita construir como "candles" directamente.
   * Resposta de sucesso vem com msg_type "history" e um objecto
   * { prices: number[], times: number[] } (arrays paralelos).
   * Em caso de erro, vem com msg_type "ticks_history", tal como no pedido
   * de candles.
   */
  requestRawTicksHistory(symbol: string, count: number, end: number | "latest" = "latest") {
    this.send({
      ticks_history: symbol,
      end,
      count,
      style: "ticks",
      adjust_start_time: 1,
    });
  }

  /**
   * Digits V1 proposal. One fixed 1-tick contract is requested and the
   * configured digit is sent as the barrier for the contracts that need it.
   */
  async getDigitsProposal(
    symbol: string,
    contractType: DigitsContractType,
    amount: number,
    duration = 1,
    targetDigit = 9
  ) {
    if (!symbol) throw new Error("Símbolo Digits ausente.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Stake Digits inválida.");

    const needsDigit = ["DIGITUNDER", "DIGITOVER", "DIGITMATCH", "DIGITDIFF"].includes(contractType);
    if (needsDigit && (!Number.isInteger(targetDigit) || targetDigit < 0 || targetDigit > 9)) {
      throw new Error("Dígito alvo inválido. Deve estar entre 0 e 9.");
    }

    const data = await this.request<any>({
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: contractType,
      currency: this.accountCurrency,
      duration,
      duration_unit: "t",
      underlying_symbol: symbol,
      ...(needsDigit ? { barrier: String(targetDigit) } : {}),
    }, "proposal", 15000);

    if (data.error) throw new Error(data.error.message || "Erro em proposal Digits");
    if (!data.proposal?.id) throw new Error("Proposal Digits sem ID.");
    return data.proposal;
  }

  /**
   * Accumulators (ACCU) V1 proposal. ACCU contracts have no fixed
   * duration/duration_unit — the range is open-ended and only ends when the
   * spot breaches the accumulator range, the user sells early, or an
   * optional take_profit limit_order is hit. growthRate must be one of the
   * five rates Deriv supports for ACCU: 0.01, 0.02, 0.03, 0.04, 0.05.
   * See https://developers.deriv.com/docs/accumulator-options
   */
  async getAccumulatorsProposal(
    symbol: string,
    amount: number,
    growthRate: number,
    takeProfit?: number,
  ) {
    if (!symbol) throw new Error("Símbolo Accumulators ausente.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Stake Accumulators inválida.");
    const validRates = [0.01, 0.02, 0.03, 0.04, 0.05];
    if (!validRates.includes(growthRate)) {
      throw new Error("Growth Rate inválido. Deve ser um de: 1%, 2%, 3%, 4%, 5%.");
    }

    const data = await this.request<any>({
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: "ACCU",
      currency: this.accountCurrency,
      symbol,
      growth_rate: growthRate,
      ...(takeProfit && takeProfit > 0 ? { limit_order: { take_profit: takeProfit } } : {}),
    }, "proposal", 15000);

    if (data.error) throw new Error(data.error.message || "Erro em proposal Accumulators");
    if (!data.proposal?.id) throw new Error("Proposal Accumulators sem ID.");
    return data.proposal;
  }

  /**
   * Fecha um contrato antes da expiração (ou, no caso dos Accumulators, que
   * não têm expiração fixa, a qualquer momento). price=0 vende ao preço de
   * mercado ("sell at market"), tal como documentado pela Deriv.
   */
  async sellContract(contractId: string, price = 0) {
    if (!contractId) throw new Error("Contract ID ausente para sell.");
    const data = await this.request<any>({
      sell: contractId,
      price,
    }, "sell", 15000);
    if (data.error) throw new Error(data.error.message || "Erro em sell");
    const sell = data.sell;
    if (!sell) throw new Error("Resposta de sell vazia.");
    return {
      contractId: String(sell.contract_id ?? contractId),
      soldFor: toFiniteNumber(sell.sold_for),
      balanceAfter: toFiniteNumber(sell.balance_after),
      transactionId: sell.transaction_id != null ? String(sell.transaction_id) : undefined,
      raw: data,
    };
  }

  /**
   * New API authenticated buy. D17 uses this Promise-based gateway so the
   * executor only reports success after Deriv returns a valid buy response
   * containing a contract_id. No loginid is sent (New API).
   */
  async buyProposal(proposalId: string, price: number) {
    if (!proposalId) throw new Error("Proposal ID ausente para buy.");
    if (!Number.isFinite(price) || price <= 0) throw new Error("Preço da Proposal inválido para buy.");

    const data = await this.request<any>({
      buy: proposalId,
      price,
    }, "buy", 15000);

    if (data.error) throw new Error(data.error.message || "Erro em buy");
    const buy = data.buy;
    if (!buy?.contract_id) throw new Error("Resposta de buy sem contract_id.");

    return {
      contractId: String(buy.contract_id),
      transactionId: buy.transaction_id != null ? String(buy.transaction_id) : undefined,
      buyPrice: toFiniteNumber(buy.buy_price),
      payout: toFiniteNumber(buy.payout),
      purchaseTime: toFiniteNumber(buy.purchase_time),
      startTime: toFiniteNumber(buy.start_time),
      balanceAfter: toFiniteNumber(buy.balance_after),
      raw: data,
    };
  }

  /** Legacy fire-and-forget helper retained for existing UI code. D17 does not use it. */
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

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new DerivAuthError(
          `Token Deriv inválido ou expirado (HTTP ${res.status}).`,
          res.status
        );
      }
      throw new Error(`fetchAccounts failed: ${res.status}`);
    }
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
      this.accountCurrency = String(demo.currency ?? this.accountCurrency);
      this._connectViaOTP(this.activeAccountId);
    } catch (e: any) {
      if (epoch === this._epoch) {
        this._emitAuthError(
          isDerivAuthError(e)
            ? "Token Deriv inválido ou expirado. Insere um novo token para continuar."
            : (e.message || "Falha ao autenticar na Deriv."),
          isDerivAuthError(e) ? e.code : "AuthError"
        );
      }
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
        this._emitAuthError(
          isDerivAuthError(e)
            ? "Token Deriv inválido ou expirado. Insere um novo token para continuar."
            : (e.message || "Falha na autenticação Deriv."),
          isDerivAuthError(e) ? e.code : "AuthError"
        );
        // Não repetir automaticamente uma tentativa com a mesma credencial
        // quando a própria Deriv recusou o PAT.
        if (!isDerivAuthError(e)) this._scheduleReconnect(epoch);
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
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new DerivAuthError(
          `Token Deriv inválido ou expirado (OTP recusado: HTTP ${res.status}).`,
          res.status
        );
      }
      throw new Error(`OTP failed: ${res.status}`);
    }
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
      this.lastMessageAt = Date.now();
      this._startHeartbeat(epoch);

      try {
        const accounts = await this.fetchAccounts();
        if (epoch !== this._epoch) return;
        const account = accounts.find((a) => a.account_id === accountId) ?? accounts[0];
        const balance = Number(account?.balance ?? 0);
        const accountType = this._isDemo(account) ? "Demo" : "Real";
        logger.system(`✓ Autorizado | ${accountId} [${accountType}] | Saldo: $${balance.toFixed(2)}`);
        this.accountCurrency = String(account?.currency ?? this.accountCurrency);
        this._emit("authorize", {
          authorize: {
            balance,
            loginid: account?.account_id ?? accountId,
            currency: this.accountCurrency,
            is_virtual: this._isDemo(account) ? 1 : 0,
          },
        });
      } catch {
        if (epoch !== this._epoch) return;
        logger.system(`✓ Autorizado | ${accountId} | (saldo não disponível)`);
        this._emit("authorize", {
          authorize: { balance: 0, loginid: accountId, currency: this.accountCurrency, is_virtual: this.isDemo ? 1 : 0 },
        });
      }
    };

    this.socket.onmessage = (event) => {
      if (epoch !== this._epoch) return;
      this.lastMessageAt = Date.now();
      try {
        const data = JSON.parse(event.data) as DerivMessage;
        if (data.msg_type === "ping" && data.req_id !== undefined) {
          this.lastPongAt = Date.now();
          this.heartbeatInFlight = false;
        }
        if (this._debugLogAll) {
          logger.system(`[Debug] Recebido: msg_type=${data.msg_type ?? "(nenhum)"} ${data.error ? `| error=${data.error.message}` : ""}`);
        }
        if (data.req_id !== undefined) {
          const pending = this.pendingRequests.get(Number(data.req_id));
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(Number(data.req_id));
            if (data.error) pending.reject(new Error(data.error.message || `Deriv API error (${data.error.code || "unknown"})`));
            else pending.resolve(data);
          }
        }
        if (data.msg_type) this._emit(data.msg_type, data);
      } catch (e) {
        console.error("[Deriv] Parse error:", e);
        if (this._debugLogAll) logger.error(`[Debug] Falha ao interpretar mensagem recebida: ${e}`);
      }
    };

    this.socket.onerror = () => {
      if (epoch !== this._epoch) return;
      console.error("[Deriv] WebSocket error");
    };

    this.socket.onclose = (event) => {
      if (epoch !== this._epoch) return; // ignorar close de socket antigo
      this._stopHeartbeat();
      this._rejectPendingRequests(`WebSocket Deriv desconectado (code ${event.code}).`);
      this.heartbeatInFlight = false;
      console.log(`[Deriv] Closed (code ${event.code}, epoch ${epoch})`);
      if (!this.isIntentionallyDisconnected) {
        logger.system(`WebSocket desconectado (code ${event.code}) — a reconectar...`);
        this._scheduleReconnect(epoch);
      }
    };
  }

  private _closeSocket() {
    this._stopHeartbeat();
    this.heartbeatInFlight = false;
    this._rejectPendingRequests("WebSocket Deriv encerrado.");
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


  /**
   * New API heartbeat. A ping is sent every 30s, within Deriv's documented
   * 30–60s keep-alive window. If a ping cannot be answered, the socket is
   * closed so the normal reconnect path can establish a fresh OTP/WebSocket.
   */
  private _startHeartbeat(epoch: number) {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (epoch !== this._epoch || !this.isSocketOpen()) {
        this._stopHeartbeat();
        return;
      }

      if (this.heartbeatInFlight) {
        logger.error("Heartbeat Deriv sem resposta — a reiniciar a ligação.");
        this._closeSocket();
        if (!this.isIntentionallyDisconnected && epoch === this._epoch) {
          this._scheduleReconnect(epoch);
        }
        return;
      }

      this.heartbeatInFlight = true;
      this.lastPingAt = Date.now();
      this.request<any>({ ping: 1 }, "ping", 10000)
        .then(() => {
          this.lastPongAt = Date.now();
          this.heartbeatInFlight = false;
        })
        .catch(() => {
          this.heartbeatInFlight = false;
          if (epoch !== this._epoch || this.isIntentionallyDisconnected) return;
          logger.error("Heartbeat Deriv sem resposta — a reiniciar a ligação.");
          this._closeSocket();
          this._scheduleReconnect(epoch);
        });
    }, 30000);
  }

  private _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _rejectPendingRequests(message: string) {
    if (!this.pendingRequests.size) return;
    const pending = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();
    pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error(message));
    });
  }

  private _scheduleReconnect(epoch: number) {
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      console.warn("[Deriv] Max reconnect attempts reached");
      return;
    }
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectCount++;
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

  private _emitAuthError(message: string, code = "AuthError") {
    logger.error(`Erro de autorização: ${message}`);
    this._emit("authorize", { error: { code, message } });
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


function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
