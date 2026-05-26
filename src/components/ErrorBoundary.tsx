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
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 p-8">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-black text-white uppercase tracking-wide">
              {this.props.fallbackLabel || "Erro ao carregar"}
            </p>
            <p className="text-[11px] text-muted-foreground max-w-xs">
              {this.state.error}
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
