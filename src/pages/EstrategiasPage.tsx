import React from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
const StrategyPanel = React.lazy(() => import("../components/StrategyPanel").then(m => ({ default: m.StrategyPanel })));
const BacktestPanel = React.lazy(() => import("../components/BacktestPanel").then(m => ({ default: m.BacktestPanel })));

export const EstrategiasPage = () => (
  <div className="space-y-8">
    <ErrorBoundary fallbackLabel="Erro na Estratégia">
      <React.Suspense fallback={<PageLoading label="Estratégias" />}>
        <StrategyPanel />
      </React.Suspense>
    </ErrorBoundary>
    <ErrorBoundary fallbackLabel="Erro no Backtest">
      <React.Suspense fallback={<PageLoading label="Backtest" />}>
        <BacktestPanel />
      </React.Suspense>
    </ErrorBoundary>
  </div>
);

const PageLoading = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center min-h-[200px] gap-3">
    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
    <p className="text-[11px] text-muted-foreground uppercase font-bold tracking-widest">A carregar {label}...</p>
  </div>
);
