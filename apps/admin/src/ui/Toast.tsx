import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useT } from "../i18n/LanguageProvider";

type ToastTone = "info" | "success" | "error";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 0;

/** A small tone glyph (check / alert / info) shown left of the toast message. */
function ToastIcon({ tone }: { tone: ToastTone }): JSX.Element {
  const path =
    tone === "success"
      ? "M5 12l4 4 10-10"
      : tone === "error"
        ? "M12 7v6M12 17h.01"
        : "M12 11v6M12 7h.01";
  return (
    <svg
      className="toast__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {tone === "success" ? null : <circle cx="12" cy="12" r="9" />}
      <path d={path} />
    </svg>
  );
}

/** App-wide notice stack. Toasts persist until dismissed; the region is a polite live area. */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const t = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, tone }]);
  }, []);

  const api = useMemo<ToastApi>(() => ({ notify }), [notify]);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-live="polite" aria-label={t("admin.notify.label")}>
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <ToastIcon tone={toast.tone} />
            <span className="toast__body">{toast.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label={t("admin.action.close")}
              onClick={() => dismiss(toast.id)}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Imperative notice API. Throws if used outside <ToastProvider>. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return api;
}
