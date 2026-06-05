import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@telegram-apps/telegram-ui/dist/styles.css";
import { App } from "./App";
import { ApiProvider } from "./api/ApiProvider";
import { LanguageProvider } from "./i18n/LanguageProvider";
import { TgSdkProvider } from "./tg/TgSdkProvider";
import "./ui/theme.css";

declare global {
  interface Window {
    __beosandMiniappReportError?: (
      kind: string,
      payload: { message?: string; stack?: string; componentStack?: string }
    ) => void;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false }
  }
});

class MiniappErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null };

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setState({ message });
    window.__beosandMiniappReportError?.("react.error-boundary", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
      componentStack: info.componentStack ?? undefined
    });
  }

  render(): ReactNode {
    if (this.state.message) {
      return (
        <pre style={{ margin: 16, whiteSpace: "pre-wrap" }}>
          Mini App render error{"\n"}
          {this.state.message}
        </pre>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

// Provider stack (outer → inner): the Telegram SDK environment first (it supplies
// initData), then react-query, then the ApiClient (which authenticates on boot),
// then i18n (which seeds its locale from the verified identity).
createRoot(container).render(
  <StrictMode>
    <MiniappErrorBoundary>
      <TgSdkProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider>
            <LanguageProvider>
              <App />
            </LanguageProvider>
          </ApiProvider>
        </QueryClientProvider>
      </TgSdkProvider>
    </MiniappErrorBoundary>
  </StrictMode>
);
