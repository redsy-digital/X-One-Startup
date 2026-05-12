import { jsPDF } from "jspdf";
import { TradeHistory } from "../types";

const STORAGE_KEY = "trade_history";
const MAX_HISTORY = 500;

export const getTradeHistory = (): TradeHistory[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Error reading trade history", e);
    return [];
  }
};

export const saveTrade = (trade: TradeHistory) => {
  try {
    const history = getTradeHistory();
    // Update if exists, or append
    const index = history.findIndex(h => h.id === trade.id);
    let newHistory;
    if (index >= 0) {
      newHistory = [...history];
      newHistory[index] = { ...newHistory[index], ...trade };
    } else {
      newHistory = [trade, ...history];
    }
    
    // Keep last 500
    if (newHistory.length > MAX_HISTORY) {
      newHistory = newHistory.slice(0, MAX_HISTORY);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(new Event("trade_history_updated"));
  } catch (e) {
    console.error("Error saving trade", e);
  }
};

export const clearTradeHistory = () => {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("trade_history_updated"));
};

export const exportToPDF = async (history: TradeHistory[]) => {
  const doc = new jsPDF();
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toLocaleTimeString();

  // Header
  doc.setFontSize(22);
  doc.setTextColor(139, 92, 246); // Purple
  doc.text("X-ONE IA - Histórico de Trades", 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Data de Exportação: ${dateStr} ${timeStr}`, 14, 30);
  doc.text(`Total de Operações: ${history.length}`, 14, 35);

  // Table Config
  const startY = 45;
  let currentY = startY;
  const colWidths = [40, 20, 20, 20, 15, 15, 45]; // Total 175
  const headers = ["Data/Hora", "Tipo", "Result", "Lucro", "Conf.", "IA", "Mercado"];

  // Draw Header
  doc.setFillColor(243, 244, 246);
  doc.rect(14, currentY - 5, 182, 7, 'F');
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
      
      // Redraw header on new page
      doc.setFillColor(243, 244, 246);
      doc.rect(14, currentY - 5, 182, 7, 'F');
      doc.setFont("helvetica", "bold");
      let hX = 14;
      headers.forEach((h, i) => {
        doc.text(h, hX, currentY);
        hX += colWidths[i];
      });
      currentY += 8;
      doc.setFont("helvetica", "normal");
    }

    const tradeTime = new Date(trade.time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const result = trade.status === "WON" ? "WIN" : (trade.status === "PENDING" ? "PENDENTE" : "LOSS");
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

    // Set color based on result
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

    // Sub-row 1: Strategic Context
    currentY += 4;
    doc.setFontSize(6);
    doc.setTextColor(100);
    doc.text(`Freshness: ${freshness}/10 | Timing: ${timing}/10 | EMA Stretch: ${emaStretch} | Estrutura: ${structure}`, 14, currentY);
    
    // Sub-row 2: Strategy Reason
    currentY += 4;
    doc.text(`Causa: ${reason}`, 14, currentY);

    // Sub-row 3: Penalties if any
    if (trade.indicators?.confidencePenaltyReasons?.length) {
      currentY += 4;
      doc.setTextColor(150, 0, 0);
      doc.text(`Penalidades: ${penalties}`, 14, currentY);
    }
    
    currentY += 6;
    doc.setFontSize(8);
    doc.setTextColor(0);
  });

  // Footer / Final Save
  doc.save(`trade-history-${dateStr}.pdf`);
};
