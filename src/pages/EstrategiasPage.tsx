import React from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
const DigitsPanel = React.lazy(() => import("../components/DigitsPanel").then(m => ({ default: m.DigitsPanel })));

export const EstrategiasPage = () => (
  <ErrorBoundary fallbackLabel="Erro no Digits V1">
    <React.Suspense fallback={<PageLoading label="Digits V1" />}>
      <DigitsPanel />
    </React.Suspense>
  </ErrorBoundary>
);

const PageLoading = ({ label }: { label: string }) => (
  <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
    <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
    <p className="text-[11px] text-muted-foreground uppercase font-bold tracking-widest">A carregar {label}...</p>
  </div>
);
