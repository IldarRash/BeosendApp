import { BadRequestException, Logger, type CallHandler, type ExecutionContext } from "@nestjs/common";
import type { SettingsService } from "../modules/settings/settings.service";
import { describe, expect, it, vi, afterEach } from "vitest";
import { lastValueFrom, of, throwError } from "rxjs";
import { RequestLoggingInterceptor } from "./request-logging.interceptor";

interface LoggedEntry {
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

function settings(detailed: boolean): SettingsService {
  return {
    requestLoggingDetailedEnabled: vi.fn(async () => detailed)
  } as unknown as SettingsService;
}

function context(request: Record<string, unknown>, statusCode = 200): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode })
    })
  } as unknown as ExecutionContext;
}

function handlerValue(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function handlerError(error: unknown): CallHandler {
  return { handle: () => throwError(() => error) };
}

async function flushLog(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RequestLoggingInterceptor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ordinary mode logs route metadata without query, body, or headers", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const interceptor = new RequestLoggingInterceptor(settings(false));

    await lastValueFrom(
      interceptor.intercept(
        context({
          method: "POST",
          path: "/bookings",
          query: { token: "raw" },
          body: { password: "raw" },
          headers: { "x-telegram-id": "111", authorization: "Bearer raw" }
        }),
        handlerValue({ ok: true })
      )
    );
    await flushLog();

    const entry = logSpy.mock.calls[0]?.[0] as LoggedEntry;
    expect(entry).toMatchObject({
      event: "api.request",
      method: "POST",
      path: "/bookings",
      actor: { telegramId: "111" },
      status: 200,
      detailed: false
    });
    expect(entry.durationMs).toEqual(expect.any(Number));
    expect(entry.query).toBeUndefined();
    expect(entry.body).toBeUndefined();
    expect(entry.headers).toBeUndefined();
  });

  it("detailed mode includes sanitized query, body, selected headers, and client actor", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const interceptor = new RequestLoggingInterceptor(settings(true));

    await lastValueFrom(
      interceptor.intercept(
        context({
          method: "PATCH",
          originalUrl: "/settings/request-logging?jwt=raw",
          query: { jwt: "raw", page: "1" },
          body: { detailed: true, nested: { photoUrl: "https://example.test/a.jpg" } },
      headers: {
        "content-type": "application/json",
        "x-client-telegram-id": "222",
        authorization: "Bearer raw",
            cookie: "adminSession=raw"
          }
        }),
        handlerValue({ detailed: true })
      )
    );
    await flushLog();

    const entry = logSpy.mock.calls[0]?.[0] as LoggedEntry;
    expect(entry).toMatchObject({
      event: "api.request",
      method: "PATCH",
      path: "/settings/request-logging",
      actor: { clientTelegramId: "222" },
      status: 200,
      detailed: true,
      query: { jwt: "[masked]", page: "1" },
      body: { detailed: true, nested: { photoUrl: "[masked]" } },
      headers: {
        "content-type": "application/json",
        "x-client-telegram-id": "[masked]",
        authorization: "[masked]",
        cookie: "[masked]"
      }
    });
  });

  it("masks auth request bodies in detailed mode while preserving sanitized query and headers", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const interceptor = new RequestLoggingInterceptor(settings(true));

    await lastValueFrom(
      interceptor.intercept(
        context({
          method: "POST",
          path: "/auth/miniapp",
          query: { status: "login", token: "raw" },
          body: { initData: "query_id=raw&hash=raw", detailed: true },
          headers: {
            "content-type": "application/json",
            authorization: "Bearer raw"
          }
        }),
        handlerValue({ ok: true })
      )
    );
    await flushLog();

    const entry = logSpy.mock.calls[0]?.[0] as LoggedEntry;
    expect(entry).toMatchObject({
      method: "POST",
      path: "/auth/miniapp",
      detailed: true,
      query: { status: "login", token: "[masked]" },
      body: "[masked]",
      headers: {
        "content-type": "application/json",
        authorization: "[masked]"
      }
    });
  });

  it("skips oversized detailed bodies from content-length", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const interceptor = new RequestLoggingInterceptor(settings(true));

    await lastValueFrom(
      interceptor.intercept(
        context({
          method: "POST",
          path: "/connectors/webhooks",
          body: { status: "queued" },
          headers: {
            "content-length": String(70 * 1024)
          }
        }),
        handlerValue({ ok: true })
      )
    );
    await flushLog();

    const entry = logSpy.mock.calls[0]?.[0] as LoggedEntry;
    expect(entry.body).toBe("[truncated]");
  });

  it("logs thrown errors with their HTTP status and preserves the original error", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const interceptor = new RequestLoggingInterceptor(settings(true));
    const error = new BadRequestException("invalid");

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({
            method: "GET",
            path: "/settings/request-logging",
            query: { secret: "raw" },
            headers: { "x-telegram-id": "111" }
          }),
          handlerError(error)
        )
      )
    ).rejects.toBe(error);
    await flushLog();

    const entry = logSpy.mock.calls[0]?.[0] as LoggedEntry;
    expect(entry).toMatchObject({
      method: "GET",
      path: "/settings/request-logging",
      status: 400,
      detailed: true,
      query: { secret: "[masked]" }
    });
    expect(entry.durationMs).toEqual(expect.any(Number));
  });

  it("falls back to ordinary logging when reading the detailed setting fails", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const failingSettings = {
      requestLoggingDetailedEnabled: vi.fn(async () => {
        throw new Error("db unavailable");
      })
    } as unknown as SettingsService;
    const interceptor = new RequestLoggingInterceptor(failingSettings);

    await lastValueFrom(
      interceptor.intercept(
        context({
          method: "GET",
          path: "/health",
          query: { token: "raw" },
          headers: {}
        }),
        handlerValue({ ok: true })
      )
    );
    await flushLog();

    const entry = logSpy.mock.calls[0]?.[0] as LoggedEntry;
    expect(entry).toMatchObject({ method: "GET", path: "/health", detailed: false });
    expect(entry.query).toBeUndefined();
  });

  it("does not include a delayed detailed setting lookup in durationMs", async () => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_123).mockReturnValue(9_999);
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const delayedSettings = {
      requestLoggingDetailedEnabled: vi.fn(
        () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_000))
      )
    } as unknown as SettingsService;
    const interceptor = new RequestLoggingInterceptor(delayedSettings);

    await lastValueFrom(
      interceptor.intercept(
        context({
          method: "GET",
          path: "/settings/request-logging",
          headers: {}
        }),
        handlerValue({ detailed: true })
      )
    );
    expect(logSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    const entry = logSpy.mock.calls[0]?.[0] as LoggedEntry;
    expect(entry.durationMs).toBe(123);
    expect(entry).toMatchObject({ detailed: true, path: "/settings/request-logging" });
  });
});
