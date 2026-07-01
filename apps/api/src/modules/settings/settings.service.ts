import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import {
  managerContactSchema,
  managerContactTelegramUrl,
  managerContactValueSchema,
  type ManagerContact,
  type UpdateManagerContactInput
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { SettingsRepository } from "./settings.repository";

const MANAGER_CONTACT_KEY = "manager_contact";

/** Owns settings domain logic: env fallback, admin gate, and contact URL derivation. */
@Injectable()
export class SettingsService {
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

  private toManagerContact(value: string): ManagerContact {
    const contact = managerContactValueSchema.parse(value);
    return managerContactSchema.parse({
      contact,
      url: managerContactTelegramUrl(contact)
    });
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
