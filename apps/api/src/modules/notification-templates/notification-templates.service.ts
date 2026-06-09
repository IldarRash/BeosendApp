import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { NotificationTemplate, NotificationTemplateKey } from "@beosand/types";
import { NOTIFICATION_TEMPLATE_PLACEHOLDERS, notificationTemplateKey } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { DEFAULT_TEMPLATES } from "../notifications/notification-messages";
import { NotificationTemplatesRepository } from "./notification-templates.repository";

/**
 * Owns notification-template logic (Slice F): the admin can override the body
 * text of the 7 client-facing single-training notifications. All operations are
 * admin-only, gated here by ADMIN_TELEGRAM_IDS via isAdmin — the reusable
 * admin-auth-in-service convention (mirrors I18nService/BroadcastsService),
 * never in the controller or bot.
 *
 * The effective body for an event is its DB override if set, else the code
 * default (DEFAULT_TEMPLATES). A missing row means "use the default".
 */
@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly repo: NotificationTemplatesRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Admin: every editable event with its effective body, default, and placeholders. */
  async list(actorTelegramId: number): Promise<NotificationTemplate[]> {
    this.assertAdmin(actorTelegramId);
    const overrides = await this.repo.listOverrides();
    return notificationTemplateKey.options.map((eventKey) =>
      this.toTemplate(eventKey, overrides.get(eventKey))
    );
  }

  /** Admin: one event's effective body, default, override flag, and placeholders. */
  async getOne(
    actorTelegramId: number,
    eventKey: NotificationTemplateKey
  ): Promise<NotificationTemplate> {
    this.assertAdmin(actorTelegramId);
    const override = await this.repo.findOverride(eventKey);
    return this.toTemplate(eventKey, override);
  }

  /** Admin: upsert one event's override body. Returns the new effective template. */
  async update(
    actorTelegramId: number,
    eventKey: NotificationTemplateKey,
    body: string
  ): Promise<NotificationTemplate> {
    this.assertAdmin(actorTelegramId);
    const row = await this.repo.upsert(eventKey, body);
    return this.toTemplate(eventKey, row.body);
  }

  /** Admin: remove one event's override (reset to the code default). */
  async reset(
    actorTelegramId: number,
    eventKey: NotificationTemplateKey
  ): Promise<NotificationTemplate> {
    this.assertAdmin(actorTelegramId);
    await this.repo.remove(eventKey);
    return this.toTemplate(eventKey, undefined);
  }

  /** Map an event + optional override to the editor contract shape. */
  private toTemplate(
    eventKey: NotificationTemplateKey,
    override: string | undefined
  ): NotificationTemplate {
    const defaultBody = DEFAULT_TEMPLATES[eventKey];
    return {
      eventKey,
      body: override ?? defaultBody,
      isOverridden: override !== undefined,
      defaultBody,
      placeholders: NOTIFICATION_TEMPLATE_PLACEHOLDERS[eventKey]
    };
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }
}
