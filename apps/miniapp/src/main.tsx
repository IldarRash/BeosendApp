import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@telegram-apps/telegram-ui/dist/styles.css";
import { App } from "./App";
import { ApiProvider } from "./api/ApiProvider";
import { LanguageProvider } from "./i18n/LanguageProvider";
import { TgSdkProvider } from "./tg/TgSdkProvider";
import "./ui/theme.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false }
  }
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

// Provider stack (outer → inner): the Telegram SDK environment first (it supplies
// initData), then react-query, then the ApiClient (which authenticates on boot),
// then i18n (which seeds its locale from the verified identity).
createRoot(container).render(
  <StrictMode>
    <TgSdkProvider>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <LanguageProvider>
            <App />
          </LanguageProvider>
        </ApiProvider>
      </QueryClientProvider>
    </TgSdkProvider>
  </StrictMode>
);
