import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor
} from "@nestjs/common";
import { catchError, tap, throwError, type Observable } from "rxjs";
import { SettingsService } from "../modules/settings/settings.service";
import { sanitizeForRequestLog, sanitizeSelectedHeaders } from "./request-log-sanitizer";

const MASKED = "[masked]";
const TRUNCATED = "[truncated]";
const MAX_DETAILED_BODY_CONTENT_LENGTH = 64 * 1024;

interface RequestLike {
  method?: string;
  path?: string;
  url?: string;
  originalUrl?: string;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  statusCode?: number;
}

interface HttpErrorLike {
  getStatus?: () => number;
  status?: number;
  statusCode?: number;
  response?: {
    statusCode?: number;
  };
}

interface RequestLogEntry {
  event: "api.request";
  method: string;
  path: string;
  actor: {
    telegramId?: string;
    clientTelegramId?: string;
  };
  status: number;
  durationMs: number;
  detailed: boolean;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, unknown>;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);

  constructor(private readonly settings: SettingsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const response = http.getResponse<ResponseLike>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        void this.logRequest(request, response.statusCode ?? 200, startedAt);
      }),
      catchError((error: unknown) => {
        void this.logRequest(request, statusFromError(error), startedAt);
        return throwError(() => error);
      })
    );
  }

  private async logRequest(request: RequestLike, status: number, startedAt: number): Promise<void> {
    try {
      const durationMs = Date.now() - startedAt;
      const path = requestPath(request);
      const detailed = await this.detailedEnabled();
      const headers = request.headers ?? {};
      const entry: RequestLogEntry = {
        event: "api.request",
        method: request.method ?? "UNKNOWN",
        path,
        actor: {
          telegramId: headerValue(headers["x-telegram-id"]),
          clientTelegramId: headerValue(headers["x-client-telegram-id"])
        },
        status,
        durationMs,
        detailed
      };

      if (detailed) {
        entry.query = sanitizeForRequestLog(request.query ?? {});
        entry.body = bodyForDetailedLog(request, headers, path);
        entry.headers = sanitizeSelectedHeaders(headers);
      }

      this.logger.log(entry);
    } catch {
      return;
    }
  }

  private async detailedEnabled(): Promise<boolean> {
    try {
      return await this.settings.requestLoggingDetailedEnabled();
    } catch {
      return false;
    }
  }
}

function requestPath(request: RequestLike): string {
  if (request.path) {
    return request.path;
  }
  const url = request.originalUrl ?? request.url ?? "";
  return url.split("?")[0] ?? url;
}

function bodyForDetailedLog(
  request: RequestLike,
  headers: Record<string, string | string[] | undefined>,
  path: string
): unknown {
  if (isAuthPath(path)) {
    return MASKED;
  }
  if (isLargeBody(headers)) {
    return TRUNCATED;
  }
  return sanitizeForRequestLog(request.body ?? {});
}

function isAuthPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized === "/auth" || normalized.startsWith("/auth/");
}

function isLargeBody(headers: Record<string, string | string[] | undefined>): boolean {
  const raw = headerByName(headers, "content-length");
  const value = Number(headerValue(raw));
  return Number.isFinite(value) && value > MAX_DETAILED_BODY_CONTENT_LENGTH;
}

function headerByName(
  headers: Record<string, string | string[] | undefined>,
  wanted: string
): string | string[] | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function statusFromError(error: unknown): number {
  if (!isHttpErrorLike(error)) {
    return 500;
  }
  if (typeof error.getStatus === "function") {
    return error.getStatus();
  }
  return error.status ?? error.statusCode ?? error.response?.statusCode ?? 500;
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  return typeof error === "object" && error !== null;
}
