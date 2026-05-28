import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  children: React.ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const msg = `[${this.props.fallbackLabel || "ErrorBoundary"}] ${error.message}`;
    console.error(msg, info.componentStack);
    // Tenta registar no logger sem criar dependência circular
    try {
      const { logger } = require("../lib/logger");
      logger.error(msg);
    } catch { /* logger pode não estar disponível no root boundary */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[280px] gap-4 p-8 bg-red-950/10 rounded-2xl border border-red-500/20 m-4">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-center space-y-2 max-w-sm">
            <p className="text-sm font-black text-white uppercase tracking-wide">
              {this.props.fallbackLabel || "Erro ao carregar"}
            </p>
            <p className="text-[11px] text-red-300/80 font-mono break-all">
              {this.state.error}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Abre o painel de <strong>Logs</strong> para mais detalhes
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => this.setState({ hasError: false, error: "" })}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10 gap-2 text-[11px]"
          >
            <RefreshCw className="w-3 h-3" /> Tentar novamente
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
