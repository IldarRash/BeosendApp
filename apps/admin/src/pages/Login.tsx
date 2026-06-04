import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { telegramLoginPayloadSchema, type TelegramLoginPayload } from "@beosand/types";
import { useLogin } from "../hooks/useSession";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";

const WIDGET_SRC = "https://telegram.org/js/telegram-widget.js?22";
const ONAUTH_CALLBACK = "onTelegramAuth";

declare global {
  interface Window {
    [ONAUTH_CALLBACK]?: (user: unknown) => void;
  }
}

/**
 * Login screen. Mounts the official Telegram Login Widget (bot username from
 * VITE_TELEGRAM_BOT_USERNAME). On `onauth` the raw widget payload is validated
 * against telegramLoginPayloadSchema, then exchanged for a session at
 * POST /auth/telegram. The browser proves identity; the API verifies the HMAC and
 * the admin gate. On success we store the JWT and route to the dashboard.
 */
export function Login(): JSX.Element {
  const navigate = useNavigate();
  const login = useLogin();
  const { notify } = useToast();
  const t = useT();
  const widgetRef = useRef<HTMLDivElement>(null);
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

  useEffect(() => {
    window[ONAUTH_CALLBACK] = (user: unknown) => {
      const parsed = telegramLoginPayloadSchema.safeParse(user);
      if (!parsed.success) {
        notify(t("admin.login.badResponse"), "error");
        return;
      }
      handleLogin(parsed.data);
    };
    return () => {
      delete window[ONAUTH_CALLBACK];
    };
    // handleLogin is stable enough for this lifecycle; deps kept minimal on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const host = widgetRef.current;
    if (!host || !botUsername) return;
    host.replaceChildren();
    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", `${ONAUTH_CALLBACK}(user)`);
    script.setAttribute("data-request-access", "write");
    host.appendChild(script);
  }, [botUsername]);

  function handleLogin(payload: TelegramLoginPayload): void {
    login.mutate(payload, {
      onSuccess: () => {
        navigate("/", { replace: true });
      },
      onError: (error: Error) => {
        notify(loginErrorMessage(error, t), "error");
      }
    });
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="brand">
          <span className="brand__mark">
            Beo<em>Sand</em>
          </span>
        </div>
        <span className="brand__sub">{t("admin.brand.sub")}</span>
        <h1 className="login__title">{t("admin.login.title")}</h1>
        <p className="login__lead">{t("admin.login.lead")}</p>
        {botUsername ? (
          <div
            className="login__widget"
            ref={widgetRef}
            aria-label={t("admin.login.widgetLabel")}
          />
        ) : (
          <p className="field__error" role="alert">
            {t("admin.login.noBotUsername")}
          </p>
        )}
        {login.isPending ? <p className="login__status">{t("admin.login.checking")}</p> : null}
      </div>
    </div>
  );
}

/** A 403 from the API means the Telegram account is not an admin. */
function loginErrorMessage(error: Error, t: (key: string) => string): string {
  if (/\b403\b/.test(error.message)) {
    return t("admin.login.notAdmin");
  }
  return t("admin.login.failed");
}
