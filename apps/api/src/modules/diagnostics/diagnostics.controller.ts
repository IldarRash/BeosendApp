import { Body, Controller, Post } from "@nestjs/common";

interface MiniappClientErrorPayload {
  kind?: unknown;
  message?: unknown;
  stack?: unknown;
  componentStack?: unknown;
  url?: unknown;
  userAgent?: unknown;
  timestamp?: unknown;
}

/**
 * Temporary production diagnostic endpoint for Telegram WebView crashes.
 * It logs only client-side error metadata; do not send Telegram initData here.
 */
@Controller("diagnostics")
export class DiagnosticsController {
  @Post("miniapp-error")
  logMiniappError(@Body() body: MiniappClientErrorPayload): { ok: true } {
    console.error("[miniapp-client-error]", {
      kind: asShortString(body.kind),
      message: asShortString(body.message),
      stack: asLongString(body.stack),
      componentStack: asLongString(body.componentStack),
      url: scrubUrl(asShortString(body.url)),
      userAgent: asShortString(body.userAgent),
      timestamp: asShortString(body.timestamp)
    });
    return { ok: true };
  }
}

function asShortString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 500) : undefined;
}

function asLongString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 4_000) : undefined;
}

function scrubUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/([?&](?:tgWebAppData|hash)=)[^&]*/gi, "$1[redacted]");
}
