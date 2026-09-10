export type DigitsContractType =
  | "DIGITUNDER"
  | "DIGITOVER"
  | "DIGITMATCH"
  | "DIGITDIFF"
  | "DIGITEVEN"
  | "DIGITODD";

export const DIGITS_CONTRACTS: Array<{
  value: DigitsContractType;
  label: string;
  description: string;
  requiresDigit: boolean;
}> = [
  { value: "DIGITUNDER", label: "Under", description: "Último dígito abaixo do alvo", requiresDigit: true },
  { value: "DIGITOVER", label: "Over", description: "Último dígito acima do alvo", requiresDigit: true },
  { value: "DIGITMATCH", label: "Match", description: "Último dígito igual ao alvo", requiresDigit: true },
  { value: "DIGITDIFF", label: "Diff", description: "Último dígito diferente do alvo", requiresDigit: true },
  { value: "DIGITEVEN", label: "Even", description: "Último dígito par", requiresDigit: false },
  { value: "DIGITODD", label: "Odd", description: "Último dígito ímpar", requiresDigit: false },
];

export type DigitsTargetMode = number | "random" | "follow_up";

export interface DigitsConfig {
  contract: DigitsContractType;
  targetDigit: DigitsTargetMode;
}

export interface DigitsRiskConfig {
  stake: number;
  targetProfit: number;
  stopLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
  useAdvancedMartingale: boolean;
  advancedMartingaleContract: DigitsContractType;
  advancedMartingaleTargetDigit: number;
  maxAdvancedMartingaleSteps: number;
}

export type DigitsTradeResult = "WON" | "LOST";

export interface DigitsRuntimeState {
  currentStake: number;
  martingaleStep: number;
  advancedMartingaleStep: number;
  advancedMartingaleExhausted: boolean;
  currentContract: DigitsContractType | null;
  currentTargetDigit: number | null;
  currentStakeInTrade: number | null;
  lastContract: DigitsContractType | null;
  lastTargetDigit: number | null;
  lastExitDigit: number | null;
  lastStake: number | null;
  nextContract: DigitsContractType | null;
  nextTargetDigit: number | null;
  nextStake: number | null;
  consecutiveLosses: number;
  isProcessing: boolean;
  activeContractId: string | null;
  lastResult: DigitsTradeResult | null;
  lastTradeAt: number | null;
  lastProfit: number | null;
  entries: number;
  error: string | null;
}

export function digitsContractNeedsDigit(contract: DigitsContractType): boolean {
  return DIGITS_CONTRACTS.find((item) => item.value === contract)?.requiresDigit ?? true;
}

export function digitsContractLabel(contract: DigitsContractType, targetDigit: DigitsTargetMode): string {
  const meta = DIGITS_CONTRACTS.find((item) => item.value === contract);
  if (!meta) return contract;
  if (!meta.requiresDigit) return meta.label;
  if (targetDigit === "random") return `${meta.label} Random`;
  if (targetDigit === "follow_up") return `${meta.label} Follow Up`;
  return `${meta.label} ${targetDigit}`;
}
