import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { Locale, NotificationTemplate, NotificationTemplateKey } from "@beosand/types";
import {
  NOTIFICATION_TEMPLATE_AUDIENCE,
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
  notificationTemplateKey
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { DEFAULT_TEMPLATES } from "../notifications/notification-messages";
import {
  NotificationTemplatesRepository,
  overrideKey
} from "./notification-templates.repository";

/**
 * Owns notification-template logic: the admin can override the body text of any
 * of the 12 notification events, per locale. All operations are admin-only, gated
 * here by ADMIN_TELEGRAM_IDS via isAdmin — the reusable admin-auth-in-service
 * convention (mirrors I18nService/BroadcastsService), never in the controller or
 * bot.
 *
 * The effective body for an (event, locale) is its DB override if set, else the
 * locale's code default (DEFAULT_TEMPLATES[locale]). A missing row means "use the
 * default".
 */
@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly repo: NotificationTemplatesRepository,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Admin: every editable event for a locale with its effective body + default + placeholders. */
  async list(actorTelegramId: number, locale: Locale): Promise<NotificationTemplate[]> {
    this.assertAdmin(actorTelegramId);
    const overrides = await this.repo.listOverrides();
    return notificationTemplateKey.options.map((eventKey) =>
      this.toTemplate(eventKey, locale, overrides.get(overrideKey(eventKey, locale)))
    );
  }

  /** Admin: one event's effective body for a locale, default, override flag, placeholders. */
  async getOne(
    actorTelegramId: number,
    eventKey: NotificationTemplateKey,
    locale: Locale
  ): Promise<NotificationTemplate> {
    this.assertAdmin(actorTelegramId);
    const override = await this.repo.findOverride(eventKey, locale);
    return this.toTemplate(eventKey, locale, override);
  }

  /** Admin: upsert one (event, locale) override body. Returns the new effective template. */
  async update(
    actorTelegramId: number,
    eventKey: NotificationTemplateKey,
    locale: Locale,
    body: string
  ): Promise<NotificationTemplate> {
    this.assertAdmin(actorTelegramId);
    const row = await this.repo.upsert(eventKey, locale, body);
    return this.toTemplate(eventKey, locale, row.body);
  }

  /** Admin: remove one (event, locale) override (reset to the code default). */
  async reset(
    actorTelegramId: number,
    eventKey: NotificationTemplateKey,
    locale: Locale
  ): Promise<NotificationTemplate> {
    this.assertAdmin(actorTelegramId);
    await this.repo.remove(eventKey, locale);
    return this.toTemplate(eventKey, locale, undefined);
  }

  /** Map an event + locale + optional override to the editor contract shape. */
  private toTemplate(
    eventKey: NotificationTemplateKey,
    locale: Locale,
    override: string | undefined
  ): NotificationTemplate {
    const defaultBody = DEFAULT_TEMPLATES[locale][eventKey];
    return {
      eventKey,
      audience: NOTIFICATION_TEMPLATE_AUDIENCE[eventKey],
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
