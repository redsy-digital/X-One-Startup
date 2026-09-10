import type { DerivService } from "../../lib/deriv";
import {
  FOREX_PROPOSAL_ENGINE_VERSION,
  VALIDATED_FOREX_DURATIONS_MINUTES,
  type ForexProposalRequest,
  type ForexProposalResult,
  type ForexProposalSnapshot,
} from "./types";

/**
 * D15 — Proposal Engine.
 *
 * Converts an approved D13 PROPOSAL_CHECK into a real Deriv `proposal`
 * request. It NEVER calls `buy` and it never changes risk/stake.
 *
 * The four durations and observed minimum stake are inherited from the
 * previously validated X-One Forex contract investigation; D15 does not
 * reopen that research.
 */
export class ForexProposalEngineV1 {
  constructor(private readonly deriv: DerivService) {}

  async request(input: ForexProposalRequest): Promise<ForexProposalResult> {
    const validation = this.validateRequest(input);
    if (validation) return validation;

    try {
      const raw = await this.deriv.probeProposal(
        input.symbol,
        input.direction,
        input.stake,
        input.durationMinutes,
        "m",
        input.currency,
      );

      const id = raw?.id != null ? String(raw.id) : "";
      if (!id) {
        return {
          valid: false,
          code: "PROPOSAL_MISSING_ID",
          reason: "A Deriv devolveu uma Proposal sem ID. Sem ID não existe autorização para uma futura compra.",
          raw,
        };
      }

      const askPrice = toFiniteNumber(raw?.ask_price);
      const payout = toFiniteNumber(raw?.payout);
      const spot = toFiniteNumber(raw?.spot);

      // New API guarantees only proposal.id. ask_price can be absent, so D15
      // records that fact instead of treating a missing optional field as a
      // fake success. Buy will require a valid price later in D16/D17.
      const proposal: ForexProposalSnapshot = {
        id,
        askPrice,
        payout,
        spot,
        displayPayout: payout,
        requested: input,
        receivedAt: Math.floor(Date.now() / 1000),
      };

      return {
        valid: true,
        code: "PROPOSAL_VALID",
        reason: askPrice !== undefined
          ? "Proposal recebida com ID e ask_price válidos; pronta para o Execution Guard."
          : "Proposal recebida com ID válido. ask_price não foi devolvido e deverá ser revalidado antes do buy.",
        proposal,
        raw,
      };
    } catch (error: any) {
      return {
        valid: false,
        code: "PROPOSAL_REJECTED",
        reason: error?.message || "A Deriv rejeitou ou não respondeu à Proposal.",
      };
    }
  }

  private validateRequest(input: ForexProposalRequest): ForexProposalResult | null {
    if (!input.symbol || input.symbol !== "frxEURUSD") {
      return { valid: false, code: "INVALID_SYMBOL", reason: "D15 V1 está restrito ao símbolo Forex validado: frxEURUSD." };
    }
    if (input.direction !== "CALL" && input.direction !== "PUT") {
      return { valid: false, code: "INVALID_DIRECTION", reason: "D15 aceita somente CALL ou PUT." };
    }
    if (!Number.isFinite(input.stake) || input.stake < 0.5) {
      return { valid: false, code: "INVALID_STAKE", reason: "Stake abaixo do mínimo observado/validado de $0,50." };
    }
    if (!(VALIDATED_FOREX_DURATIONS_MINUTES as readonly number[]).includes(input.durationMinutes)) {
      return { valid: false, code: "INVALID_DURATION", reason: "Duração fora do conjunto Forex validado: 15, 30, 60 ou 120 minutos." };
    }
    return null;
  }
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export const forexProposalEngineVersion = FOREX_PROPOSAL_ENGINE_VERSION;
