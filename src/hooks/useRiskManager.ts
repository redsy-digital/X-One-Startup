import { useState, useEffect } from "react";
import confetti from "canvas-confetti";
import { useSessionStore } from "../store/useSessionStore";
import { logger } from "../lib/logger";

interface RiskManagerConfig {
  stake: number;
  targetProfit: number;
  stopLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  useSoros: boolean;
  maxSorosLevels: number;
}

interface RiskManagerState {
  currentStake: number;
  martingaleStep: number;
  sorosLevel: number;
  initialBalance: number | null;
  showModal: { show: boolean; type: "profit" | "loss"; amount: number };
}

interface RiskManagerActions {
  onWin: (profit: number) => void;
  onLoss: () => void;
  onBotStart: (balance: number) => void;
  onBotStop: () => void;
  closeModal: () => void;
}

export function useRiskManager(
  config: RiskManagerConfig,
  isBotRunning: boolean,
  balance: number | null,
  setIsBotRunning: (val: boolean) => void
): [RiskManagerState, RiskManagerActions] {
  const [currentStake, setCurrentStake] = useState(config.stake);
  const [martingaleStep, setMartingaleStep] = useState(0);
  const [sorosLevel, setSorosLevel] = useState(0);
  const [initialBalance, setInitialBalance] = useState<number | null>(null);
  const [showModal, setShowModal] = useState<{
    show: boolean;
    type: "profit" | "loss";
    amount: number;
  }>({ show: false, type: "profit", amount: 0 });

  // Monitor balance for Stop Loss / Take Profit
  useEffect(() => {
    if (!isBotRunning || initialBalance === null || balance === null) return;

    const currentProfit = balance - initialBalance;

    if (currentProfit >= config.targetProfit) {
      logger.risk(`🎯 Take Profit atingido! Sessão: +$${currentProfit.toFixed(2)}`);
      setIsBotRunning(false);
      setShowModal({ show: true, type: "profit", amount: currentProfit });
        useSessionStore.getState().setModal({ show: true, type: "profit", amount: currentProfit });
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#a855f7", "#3b82f6", "#22c55e"],
      });
    } else if (currentProfit <= -config.stopLoss) {
      logger.risk(`⛔ Stop Loss atingido. Sessão: $${currentProfit.toFixed(2)}`);
      setIsBotRunning(false);
      setShowModal({ show: true, type: "loss", amount: currentProfit });
        useSessionStore.getState().setModal({ show: true, type: "loss", amount: currentProfit });
    }
  }, [balance, initialBalance, isBotRunning, config.targetProfit, config.stopLoss]);

  const onBotStart = (bal: number) => {
    setInitialBalance(bal);
    setMartingaleStep(0);
    setSorosLevel(0);
    setCurrentStake(config.stake);
  };

  const onBotStop = () => {
    // No stake reset needed — will reset on next start
  };

  const onWin = (profit: number) => {
    useSessionStore.getState().recordWin(profit);
    setMartingaleStep(0);

    if (config.useSoros) {
      const nextStake = currentStake + profit;
      setCurrentStake(nextStake);
      setSorosLevel((prev) => {
        const next = prev + 1;
        if (next >= config.maxSorosLevels) {
          setCurrentStake(config.stake);
          return 0;
        }
        return next;
      });
    } else {
      setCurrentStake(config.stake);
    }
  };

  const onLoss = () => {
    useSessionStore.getState().recordLoss(-currentStake);
    setSorosLevel(0);

    if (config.useMartingale && martingaleStep < config.maxMartingaleSteps) {
      const nextStep = martingaleStep + 1;
      const nextStakeVal = config.stake * Math.pow(config.martingaleMultiplier, nextStep);
      logger.risk(`Martingale step ${nextStep}/${config.maxMartingaleSteps} | Próxima stake: $${nextStakeVal.toFixed(2)}`);
      setMartingaleStep(nextStep);
      setCurrentStake(nextStakeVal);
    } else {
      setMartingaleStep(0);
      setCurrentStake(config.stake);
    }
  };

  const closeModal = () => {
    setShowModal((prev) => ({ ...prev, show: false }));
  };

  const state: RiskManagerState = {
    currentStake,
    martingaleStep,
    sorosLevel,
    initialBalance,
    showModal,
  };

  const actions: RiskManagerActions = {
    onWin,
    onLoss,
    onBotStart,
    onBotStop,
    closeModal,
  };

  return [state, actions];
}
