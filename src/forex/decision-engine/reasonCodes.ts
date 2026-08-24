import type { ForexReasonCode } from "./types";

export const FOREX_REASON_MESSAGES: Record<ForexReasonCode, string> = {
  ENGINE_NOT_READY: "Motor Forex ainda não está pronto.",
  UNAUTHORIZED: "Conta Deriv não autorizada.",
  MARKET_CLOSED: "Mercado Forex fechado.",
  MARKET_DATA_STALE: "Dados de mercado desatualizados.",
  INSUFFICIENT_DATA: "Dados insuficientes para calcular as features.",
  DATA_GAP: "Gap ou inconsistência nos dados de mercado.",
  FEATURE_INVALID: "Feature inválida ou não calculável.",
  REGIME_UNKNOWN: "Regime de mercado desconhecido.",
  REGIME_NOT_SUPPORTED: "Regime atual não é suportado pela estratégia congelada.",
  SIGNAL_NONE: "Não existe direção suficientemente clara.",
  SIGNAL_BELOW_THRESHOLD: "Sinal abaixo do limiar mínimo.",
  NEWS_BLOCK_HIGH_IMPACT: "Entrada bloqueada por evento económico de alto impacto.",
  NEWS_BLOCK_MEDIUM_IMPACT: "Entrada bloqueada por evento económico de impacto médio.",
  NEWS_COOLDOWN: "Período de resfriamento após evento económico.",
  NO_VALID_CONTRACT: "Nenhum contrato válido para a decisão.",
  PROPOSAL_REJECTED: "A Proposal da Deriv foi rejeitada ou deixou de ser válida.",
  RISK_LIMIT: "Motor de risco não autorizou a entrada.",
  COOLDOWN_ACTIVE: "Cooldown de risco ativo.",
  READY_FOR_EXECUTION: "Todos os gates obrigatórios passaram; pronto para Proposal/Buy.",
};
