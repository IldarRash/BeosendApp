import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import {
  managerContactSchema,
  managerContactTelegramUrl,
  managerContactValueSchema,
  requestLoggingSettingsSchema,
  type ManagerContact,
  type RequestLoggingSettings,
  type UpdateRequestLoggingSettingsInput,
  type UpdateManagerContactInput
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { SettingsRepository } from "./settings.repository";

const MANAGER_CONTACT_KEY = "manager_contact";
const REQUEST_LOGGING_DETAILED_KEY = "request_logging_detailed";
const REQUEST_LOGGING_DETAILED_CACHE_TTL_MS = 1_000;

interface RequestLoggingDetailedCache {
  detailed: boolean;
  expiresAt: number;
}

/** Owns settings domain logic: env fallback, admin gate, and contact URL derivation. */
@Injectable()
export class SettingsService {
  private requestLoggingDetailedCache: RequestLoggingDetailedCache | undefined;

  constructor(
    private readonly settings: SettingsRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  async managerContact(): Promise<ManagerContact> {
    const stored = await this.settings.findValue(MANAGER_CONTACT_KEY);
    return this.toManagerContact(stored ?? this.env.MANAGER_CONTACT);
  }

  async updateManagerContact(
    actorTelegramId: number,
    input: UpdateManagerContactInput
  ): Promise<ManagerContact> {
    this.assertAdmin(actorTelegramId);
    const value = await this.settings.upsertValue(
      MANAGER_CONTACT_KEY,
      input.contact,
      actorTelegramId
    );
    return this.toManagerContact(value);
  }

  async requestLoggingSettings(actorTelegramId: number): Promise<RequestLoggingSettings> {
    this.assertAdmin(actorTelegramId);
    return this.currentRequestLoggingSettings();
  }

  async updateRequestLoggingSettings(
    actorTelegramId: number,
    input: UpdateRequestLoggingSettingsInput
  ): Promise<RequestLoggingSettings> {
    this.assertAdmin(actorTelegramId);
    const value = input.detailed ? "true" : "false";
    const stored = await this.settings.upsertValue(
      REQUEST_LOGGING_DETAILED_KEY,
      value,
      actorTelegramId
    );
    const settings = this.toRequestLoggingSettings(stored);
    this.setRequestLoggingDetailedCache(settings.detailed);
    return settings;
  }

  async requestLoggingDetailedEnabled(): Promise<boolean> {
    const now = Date.now();
    if (
      this.requestLoggingDetailedCache &&
      this.requestLoggingDetailedCache.expiresAt > now
    ) {
      return this.requestLoggingDetailedCache.detailed;
    }

    const settings = await this.currentRequestLoggingSettings();
    this.setRequestLoggingDetailedCache(settings.detailed);
    return settings.detailed;
  }

  private toManagerContact(value: string): ManagerContact {
    const contact = managerContactValueSchema.parse(value);
    return managerContactSchema.parse({
      contact,
      url: managerContactTelegramUrl(contact)
    });
  }

  private async currentRequestLoggingSettings(): Promise<RequestLoggingSettings> {
    const stored = await this.settings.findValue(REQUEST_LOGGING_DETAILED_KEY);
    return this.toRequestLoggingSettings(stored);
  }

  private toRequestLoggingSettings(value: string | undefined): RequestLoggingSettings {
    return requestLoggingSettingsSchema.parse({
      detailed: value === "true"
    });
  }

  private setRequestLoggingDetailedCache(detailed: boolean): void {
    this.requestLoggingDetailedCache = {
      detailed,
      expiresAt: Date.now() + REQUEST_LOGGING_DETAILED_CACHE_TTL_MS
    };
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
