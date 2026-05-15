import { jsPDF } from "jspdf";
import { TradeHistory } from "../types";
import { supabase } from "./supabase";

const STORAGE_KEY = "trade_history";
const MAX_HISTORY = 500;

// ── localStorage (cache local + fallback offline) ─────────────────────────────

export const getTradeHistory = (): TradeHistory[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("[Storage] Error reading trade history from localStorage", e);
    return [];
  }
};

const saveToLocalStorage = (trade: TradeHistory) => {
  try {
    const history = getTradeHistory();
    const index = history.findIndex((h) => h.id === trade.id);
    let newHistory: TradeHistory[];

    if (index >= 0) {
      newHistory = [...history];
      newHistory[index] = { ...newHistory[index], ...trade };
    } else {
      newHistory = [trade, ...history];
    }

    if (newHistory.length > MAX_HISTORY) {
      newHistory = newHistory.slice(0, MAX_HISTORY);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(new Event("trade_history_updated"));
  } catch (e) {
    console.error("[Storage] Error saving trade to localStorage", e);
  }
};

// ── Supabase (persistência real por utilizador) ───────────────────────────────

const saveToSupabase = async (trade: TradeHistory) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // sem sessão — só localStorage

    const row = {
      id: trade.id,
      user_id: user.id,
      time: trade.time,
      symbol: trade.symbol,
      type: trade.type,
      stake: trade.stake,
      status: trade.status,
      profit: trade.profit ?? null,
      entry_price: trade.entryPrice ?? null,
      exit_price: trade.exitPrice ?? null,
      confidence: trade.confidence ?? null,
      score: trade.score ?? null,
      indicators: trade.indicators ?? null,
    };

    const { error } = await supabase
      .from("trade_history")
      .upsert(row, { onConflict: "id,user_id" });

    if (error) {
      console.error("[Storage] Supabase upsert error:", error.message);
    }
  } catch (e) {
    console.error("[Storage] Supabase save error", e);
  }
};

// ── API pública ───────────────────────────────────────────────────────────────

export const saveTrade = (trade: TradeHistory) => {
  // Síncrono: localStorage imediato
  saveToLocalStorage(trade);
  // Assíncrono: Supabase em background (fire-and-forget)
  saveToSupabase(trade);
};

export const clearTradeHistory = () => {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("trade_history_updated"));
};

export const loadHistoryFromSupabase = async (): Promise<TradeHistory[]> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return getTradeHistory(); // fallback localStorage

    const { data, error } = await supabase
      .from("trade_history")
      .select("*")
      .eq("user_id", user.id)
      .order("time", { ascending: false })
      .limit(MAX_HISTORY);

    if (error) {
      console.error("[Storage] Supabase load error:", error.message);
      return getTradeHistory(); // fallback localStorage
    }

    if (!data || data.length === 0) return getTradeHistory();

    // Normalizar nomes snake_case → camelCase
    const history: TradeHistory[] = data.map((row) => ({
      id: row.id,
      time: row.time,
      symbol: row.symbol,
      type: row.type,
      stake: Number(row.stake),
      status: row.status,
      profit: row.profit !== null ? Number(row.profit) : undefined,
      entryPrice: row.entry_price !== null ? Number(row.entry_price) : undefined,
      exitPrice: row.exit_price !== null ? Number(row.exit_price) : undefined,
      confidence: row.confidence ?? undefined,
      score: row.score !== null ? Number(row.score) : undefined,
      indicators: row.indicators ?? undefined,
    }));

    // Sincronizar localStorage com dados do Supabase
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

    return history;
  } catch (e) {
    console.error("[Storage] loadHistoryFromSupabase error", e);
    return getTradeHistory();
  }
};

// ── Exportação PDF (inalterada) ───────────────────────────────────────────────

export const exportToPDF = async (history: TradeHistory[]) => {
  const doc = new jsPDF();
  const dateStr = new Date().toISOString().split("T")[0];
  const timeStr = new Date().toLocaleTimeString();

  doc.setFontSize(22);
  doc.setTextColor(139, 92, 246);
  doc.text("X-ONE IA - Histórico de Trades", 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Data de Exportação: ${dateStr} ${timeStr}`, 14, 30);
  doc.text(`Total de Operações: ${history.length}`, 14, 35);

  const startY = 45;
  let currentY = startY;
  const colWidths = [40, 20, 20, 20, 15, 15, 45];
  const headers = ["Data/Hora", "Tipo", "Result", "Lucro", "Conf.", "IA", "Mercado"];

  doc.setFillColor(243, 244, 246);
  doc.rect(14, currentY - 5, 182, 7, "F");
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");

  let headerX = 14;
  headers.forEach((h, i) => {
    doc.text(h, headerX, currentY);
    headerX += colWidths[i];
  });

  currentY += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  history.forEach((trade) => {
    if (currentY > 280) {
      doc.addPage();
      currentY = 20;
      doc.setFillColor(243, 244, 246);
      doc.rect(14, currentY - 5, 182, 7, "F");
      doc.setFont("helvetica", "bold");
      let hX = 14;
      headers.forEach((h, i) => { doc.text(h, hX, currentY); hX += colWidths[i]; });
      currentY += 8;
      doc.setFont("helvetica", "normal");
    }

    const tradeTime = new Date(trade.time).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    const result = trade.status === "WON" ? "WIN" : trade.status === "PENDING" ? "PENDENTE" : "LOSS";
    const profit = `$${(trade.profit || 0).toFixed(2)}`;
    const confidence = `${trade.confidence || 0}%`;
    const score = `${trade.score || 0}`;
    const mkt = trade.indicators?.marketCondition || "N/A";
    const reason = trade.indicators?.reason || "Análise padrão";
    const structure = trade.indicators?.structureId || "N/A";
    const freshness = trade.indicators?.trendFreshnessScore?.toFixed(1) || "0";
    const timing = trade.indicators?.timingQuality?.toFixed(1) || "0";
    const emaStretch = trade.indicators?.emaStretchLevel?.toFixed(2) || "0";
    const penalties = trade.indicators?.confidencePenaltyReasons?.join(", ") || "Nenhum";

    if (trade.status === "WON") doc.setTextColor(0, 128, 0);
    else if (trade.status === "LOST") doc.setTextColor(200, 0, 0);
    else doc.setTextColor(100);

    let rowX = 14;
    doc.text(tradeTime, rowX, currentY); rowX += colWidths[0];
    doc.text(trade.type, rowX, currentY); rowX += colWidths[1];
    doc.text(result, rowX, currentY); rowX += colWidths[2];
    doc.text(profit, rowX, currentY); rowX += colWidths[3];
    doc.text(confidence, rowX, currentY); rowX += colWidths[4];
    doc.text(score, rowX, currentY); rowX += colWidths[5];
    doc.text(mkt, rowX, currentY);

    currentY += 4;
    doc.setFontSize(6);
    doc.setTextColor(100);
    doc.text(`Freshness: ${freshness}/10 | Timing: ${timing}/10 | EMA: ${emaStretch} | Estrutura: ${structure}`, 14, currentY);
    currentY += 4;
    doc.text(`Causa: ${reason}`, 14, currentY);
    if (trade.indicators?.confidencePenaltyReasons?.length) {
      currentY += 4;
      doc.setTextColor(150, 0, 0);
      doc.text(`Penalidades: ${penalties}`, 14, currentY);
    }

    currentY += 6;
    doc.setFontSize(8);
    doc.setTextColor(0);
  });

  doc.save(`trade-history-${dateStr}.pdf`);
};
