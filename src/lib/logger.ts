export type LogLevel = "system" | "signal" | "block" | "trade" | "risk" | "error";
export interface LogEntry { id: string; time: number; level: LogLevel; message: string; }
type Subscriber = (entry: LogEntry | null) => void;

class Logger {
  // SEM LIMITE — todos os logs são guardados durante a sessão
  private _buffer: LogEntry[] = [];
  private _subs = new Set<Subscriber>();

  subscribe(fn: Subscriber) {
    this._subs.add(fn);
    // Envia histórico completo ao subscrever
    this._buffer.forEach(e => fn(e));
    return () => this._subs.delete(fn);
  }

  private _push(level: LogLevel, message: string) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      time: Date.now(), level, message
    };
    this._buffer.push(entry);
    this._subs.forEach(fn => fn(entry));
  }

  clear() { this._buffer = []; this._subs.forEach(fn => fn(null)); }
  getAll() { return [...this._buffer]; }
  get count() { return this._buffer.length; }

  system(msg: string) { this._push("system", msg); }
  signal(msg: string) { this._push("signal", msg); }
  block(msg: string)  { this._push("block",  msg); }
  trade(msg: string)  { this._push("trade",  msg); }
  risk(msg: string)   { this._push("risk",   msg); }
  error(msg: string)  { this._push("error",  msg); }
}

export const logger = new Logger();
