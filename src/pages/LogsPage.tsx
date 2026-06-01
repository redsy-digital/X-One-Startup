import React from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
const LogsPanel = React.lazy(() => import("../components/LogsPanel").then(m => ({ default: m.LogsPanel })));

export const LogsPage = () => (
  <ErrorBoundary fallbackLabel="Erro nos Logs">
    <React.Suspense fallback={<PageLoading />}>
      <LogsPanel />
    </React.Suspense>
  </ErrorBoundary>
);

const PageLoading = () => (
  <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    <p className="text-[11px] text-muted-foreground uppercase font-bold tracking-widest">A carregar Logs...</p>
  </div>
);
