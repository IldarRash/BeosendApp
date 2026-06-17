import type { Env } from "@beosand/config";
import { describe, expect, it, vi } from "vitest";
import { SheetsDisabledError, SheetsExportService } from "./sheets-export.service";

const data = {
  findClients: vi.fn(async () => []),
  findBookings: vi.fn(async () => [])
};

describe("SheetsExportService (gated)", () => {
  it("is disabled when Google creds are absent", () => {
    const env = {
      GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
      GOOGLE_SHEETS_ID: undefined
    } as unknown as Env;
    const service = new SheetsExportService(env, data as never);
    expect(service.isEnabled()).toBe(false);
  });

  it("is disabled when only the sheet id is set (no service account)", () => {
    const env = {
      GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
      GOOGLE_SHEETS_ID: "sheet-1"
    } as unknown as Env;
    expect(new SheetsExportService(env, data as never).isEnabled()).toBe(false);
  });

  it("sync() throws SheetsDisabledError when not configured", async () => {
    const env = {
      GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
      GOOGLE_SHEETS_ID: undefined
    } as unknown as Env;
    const service = new SheetsExportService(env, data as never);
    await expect(service.sync()).rejects.toBeInstanceOf(SheetsDisabledError);
  });

  it("reports its connector id as google-sheets", () => {
    const env = {} as unknown as Env;
    expect(new SheetsExportService(env, data as never).id).toBe("google-sheets");
  });
});
