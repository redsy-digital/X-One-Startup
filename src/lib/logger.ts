/**
 * Logger singleton para o X-ONE.
 * Importável em qualquer módulo (service, hook, store).
 * Sem dependências React/Zustand — padrão pub/sub puro.
 */

export type LogLevel = "system" | "signal" | "block" | "trade" | "risk" | "error";

export interface LogEntry {
  id: string;
  time: number;
  level: LogLevel;
  message: string;
}

type Subscriber = (entry: LogEntry | null) => void; // null = clear signal

class Logger {
  private _buffer: LogEntry[] = [];
  private _subs = new Set<Subscriber>();
  private readonly MAX_ENTRIES = 300;

  /** Subscreve a novos entries. Recebe o buffer actual ao subscrever. */
  subscribe(fn: Subscriber): () => void {
    this._subs.add(fn);
    this._buffer.forEach((e) => fn(e)); // feed histórico
    return () => this._subs.delete(fn);
  }

  private _push(level: LogLevel, message: string) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: Date.now(),
      level,
      message,
    };
    if (this._buffer.length >= this.MAX_ENTRIES) this._buffer.shift();
    this._buffer.push(entry);
    this._subs.forEach((fn) => fn(entry));
  }

  clear() {
    this._buffer = [];
    this._subs.forEach((fn) => fn(null)); // null = sinal de limpeza
  }

  getAll(): LogEntry[] {
    return [...this._buffer];
  }

  // ── Níveis ────────────────────────────────────────────────────────────────
  system(msg: string) { this._push("system", msg); }
  signal(msg: string) { this._push("signal", msg); }
  block(msg: string)  { this._push("block",  msg); }
  trade(msg: string)  { this._push("trade",  msg); }
  risk(msg: string)   { this._push("risk",   msg); }
  error(msg: string)  { this._push("error",  msg); }
}

export const logger = new Logger();
