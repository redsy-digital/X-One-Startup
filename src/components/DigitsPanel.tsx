import React from "react";
import { motion } from "motion/react";
import { CircleDot, ShieldCheck, WalletCards, Zap } from "lucide-react";
import { cn } from "../lib/utils";
import { NeonCard } from "./NeonCard";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useSettingsStore } from "../store/useSettingsStore";
import { DIGITS_CONTRACTS, digitsContractNeedsDigit, digitsContractLabel, type DigitsContractType, type DigitsTargetMode } from "../digits/types";
import { useDigitsStore } from "../digits/store";
import { useBotStore } from "../store/useBotStore";

const clampNumber = (value: string, min: number, max?: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, max === undefined ? parsed : Math.min(max, parsed));
};

export const DigitsPanel = () => {
  const { settings, updateSettings, isDirty } = useSettingsStore();
  const { runtime } = useDigitsStore();
  const { isBotRunning } = useBotStore();
  const needsDigit = digitsContractNeedsDigit(settings.digitsContract);

  const setNumber = (key: keyof typeof settings, min: number, max?: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = clampNumber(e.target.value, min, max);
    if (value === null) return;
    updateSettings({ [key]: value });
  };

  const contractLabel = digitsContractLabel(settings.digitsContract, settings.digitsTargetDigit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CircleDot className="w-5 h-5 text-purple-400" />
          <div>
            <h2 className="text-lg font-black uppercase tracking-widest">Digits V1</h2>
            <p className="text-[10px] text-muted-foreground">Entrada determinística · 1 tick · sem indicadores ou previsão</p>
          </div>
        </div>
        <Badge className="bg-purple-500/10 text-purple-300 border-purple-500/30 text-[9px] font-black">{isDirty ? "A GUARDAR" : "PRONTO"}</Badge>
      </div>

      <NeonCard variant="purple" className="p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Contrato</p>
            <p className="text-lg font-black text-white mt-1">{contractLabel}</p>
          </div>
          <Zap className="w-5 h-5 text-purple-400" />
        </div>

        <div className="grid gap-3">
          <div className="space-y-1">
            <label className="text-[9px] text-muted-foreground uppercase font-black">Tipo de Digits</label>
            <Select
              value={settings.digitsContract}
              onValueChange={(value) => updateSettings({ digitsContract: value as DigitsContractType })}
              disabled={isBotRunning}
            >
              <SelectTrigger className="w-full bg-black/30 border-white/10 h-10 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#111114] border-white/10 text-white">
                {DIGITS_CONTRACTS.map((contract) => (
                  <SelectItem key={contract.value} value={contract.value}>
                    <span className="font-black">{contract.label}</span>
                    <span className="ml-2 text-muted-foreground">— {contract.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={cn("space-y-1", !needsDigit && "opacity-50")}>
            <label className="text-[9px] text-muted-foreground uppercase font-black">{needsDigit ? "Dígito alvo (0–9)" : "Paridade"}</label>
            <Select
              value={needsDigit ? String(settings.digitsTargetDigit) : (settings.digitsTargetDigit === 1 ? "odd" : "even")}
              disabled={isBotRunning}
              onValueChange={(value) => {
                if (needsDigit) {
                  updateSettings({ digitsTargetDigit: value === "random" || value === "follow_up" ? value : Number(value) });
                } else {
                  updateSettings({ digitsTargetDigit: value === "odd" ? 1 : 0 });
                }
              }}
            >
              <SelectTrigger className="w-full bg-black/30 border-white/10 h-10 text-[11px] font-black">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#111114] border-white/10 text-white">
                {needsDigit ? (
                  <>
                    {Array.from({ length: 10 }, (_, digit) => (
                      <SelectItem key={digit} value={String(digit)}>{digit}</SelectItem>
                    ))}
                    <SelectItem value="random">Random</SelectItem>
                    <SelectItem value="follow_up">Follow Up</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="even">Par</SelectItem>
                    <SelectItem value="odd">Ímpar</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <p className="text-[9px] text-muted-foreground/60">
              {needsDigit ? "Usado como alvo/barrier no contrato. Random sorteia um novo alvo a cada entrada; Follow Up usa o último dígito do contrato anterior." : "Escolhe entre resultado par ou ímpar."}
            </p>
          </div>
        </div>
      </NeonCard>

      <NeonCard variant="blue" className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <WalletCards className="w-4 h-4 text-blue-400" />
          <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Gestão de banca</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field disabled={isBotRunning} label="Stake inicial ($)" value={settings.stake} step="0.01" min={0.35} onChange={setNumber("stake", 0.35)} />
          <Field disabled={isBotRunning} label="Take Profit ($)" value={settings.targetProfit} step="0.01" min={0} onChange={setNumber("targetProfit", 0)} />
          <Field disabled={isBotRunning} label="Stop Loss ($)" value={settings.stopLoss} step="0.01" min={0} onChange={setNumber("stopLoss", 0)} />
          <Field disabled={isBotRunning} label="Máx. perdas seg." value={settings.maxConsecutiveLosses} step="1" min={1} onChange={setNumber("maxConsecutiveLosses", 1)} />
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-black text-white">Martingale</p>
              <p className="text-[9px] text-muted-foreground">Aumenta a stake após LOSS.</p>
            </div>
            <button
              type="button"
              disabled={isBotRunning}
              onClick={() => updateSettings({ useMartingale: !settings.useMartingale })}
              className={cn("w-10 h-6 rounded-full border transition-all disabled:opacity-40", settings.useMartingale ? "bg-purple-600 border-purple-400" : "bg-white/10 border-white/10")}
            >
              <span className={cn("block w-4 h-4 rounded-full bg-white transition-transform mx-0.5", settings.useMartingale ? "translate-x-4" : "translate-x-0")} />
            </button>
          </div>
          {settings.useMartingale && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field disabled={isBotRunning} label="Steps máximos" value={settings.maxMartingaleSteps} step="1" min={0} onChange={setNumber("maxMartingaleSteps", 0)} />
                <Field disabled={isBotRunning} label="Multiplicador" value={settings.martingaleMultiplier} step="0.1" min={1} onChange={setNumber("martingaleMultiplier", 1)} />
              </div>

              <div className="pt-2 border-t border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-black text-white">Martingale Avançado</p>
                    <p className="text-[9px] text-muted-foreground">Após LOSS, pode mudar contrato e dígito.</p>
                  </div>
                  <button
                    type="button"
                    disabled={isBotRunning}
                    onClick={() => updateSettings({ useAdvancedMartingale: !settings.useAdvancedMartingale })}
                    className={cn("w-10 h-6 rounded-full border transition-all disabled:opacity-40", settings.useAdvancedMartingale ? "bg-purple-600 border-purple-400" : "bg-white/10 border-white/10")}
                  >
                    <span className={cn("block w-4 h-4 rounded-full bg-white transition-transform mx-0.5", settings.useAdvancedMartingale ? "translate-x-4" : "translate-x-0")} />
                  </button>
                </div>

                {settings.useAdvancedMartingale && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] text-muted-foreground uppercase font-black">Contrato</label>
                        <Select
                          value={settings.advancedMartingaleContract}
                          disabled={isBotRunning}
                          onValueChange={value => updateSettings({ advancedMartingaleContract: value as DigitsContractType })}
                        >
                          <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-[#111114] border-white/10 text-white">
                            {DIGITS_CONTRACTS.map(contract => (
                              <SelectItem key={contract.value} value={contract.value}>{contract.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] text-muted-foreground uppercase font-black">Dígito</label>
                        <Select
                          value={String(settings.advancedMartingaleTargetDigit)}
                          disabled={isBotRunning}
                          onValueChange={value => updateSettings({ advancedMartingaleTargetDigit: Number(value) })}
                        >
                          <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-[#111114] border-white/10 text-white">
                            {Array.from({ length: 10 }, (_, digit) => (
                              <SelectItem key={digit} value={String(digit)}>{digit}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Field disabled={isBotRunning} label="Máx. aplicações avançadas seg." value={settings.maxAdvancedMartingaleSteps} step="1" min={1} onChange={setNumber("maxAdvancedMartingaleSteps", 1)} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <Field disabled={isBotRunning} label="Cooldown após limite (s)" value={settings.cooldownAfterLoss} step="1" min={0} onChange={setNumber("cooldownAfterLoss", 0)} />
      </NeonCard>

      <NeonCard variant="purple" className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Runtime</p>
            <p className="text-sm font-black text-white">{runtime.isProcessing ? "Contrato em processamento" : "Aguardando próxima entrada"}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <RuntimeMetric label="Stake actual" value={`$${runtime.currentStake.toFixed(2)}`} />
          <RuntimeMetric label="Martingale" value={`${runtime.martingaleStep}`} />
          <RuntimeMetric label="Avançado" value={`${runtime.advancedMartingaleStep}`} />
          <RuntimeMetric label="Loss seg." value={`${runtime.consecutiveLosses}`} />
          <RuntimeMetric label="Entradas" value={`${runtime.entries}`} />
        </div>
        {runtime.activeContractId && (
          <p className="mt-3 text-[9px] text-muted-foreground font-mono break-all">Contrato: {runtime.activeContractId}</p>
        )}
        {runtime.lastResult && (
          <p className={cn("mt-2 text-[10px] font-black", runtime.lastResult === "WON" ? "text-green-400" : "text-red-400")}>
            Último resultado: {runtime.lastResult} {runtime.lastProfit != null ? `(${runtime.lastProfit >= 0 ? "+" : ""}$${runtime.lastProfit.toFixed(2)})` : ""}
          </p>
        )}
        {runtime.error && <p className="mt-3 text-[10px] text-red-400 font-bold">{runtime.error}</p>}
      </NeonCard>
    </div>
  );
};

const Field = ({ label, value, step, min, onChange, disabled = false }: { label: string; value: number; step: string; min: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; disabled?: boolean }) => (
  <div className="space-y-1">
    <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
    <Input type="number" value={value} step={step} min={min} disabled={disabled} onChange={onChange} className="bg-black/30 border-white/10 h-9 text-[11px]" />
  </div>
);

const RuntimeMetric = ({ label, value }: { label: string; value: string }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-white/5 bg-white/5 p-2 text-center">
    <p className="text-[8px] uppercase text-muted-foreground font-bold">{label}</p>
    <p className="text-xs font-black text-white mt-1">{value}</p>
  </motion.div>
);
