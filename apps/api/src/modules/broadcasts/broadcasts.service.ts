import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type { ZodSchema } from "zod";
import type {
  Broadcast,
  BroadcastAudience,
  BroadcastPreview,
  BroadcastTemplate,
  BroadcastTemplateVariable,
  BroadcastType,
  CreateBroadcastTemplateInput,
  SlotCard
} from "@beosand/types";
import {
  BROADCAST_TEMPLATE_VARIABLES,
  broadcastPreviewSchema,
  broadcastTemplateSchema,
  createBroadcastTemplateSchema,
  findUnknownBroadcastTemplatePlaceholders,
  freeSeats,
  isBookable,
  isoWeekdayOf,
  updateBroadcastTemplateSchema,
  type UpdateBroadcastTemplateInput
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { TelegramSender } from "../notifications/telegram-sender";
import { type BookSlotButton, bookSlotsKeyboard } from "../notifications/notification-keyboards";
import { composeBroadcastText } from "./broadcast-messages";
import {
  signBroadcastPreviewToken,
  verifyBroadcastPreviewToken,
  type BroadcastPreviewTokenProblem
} from "./broadcast-preview-token";
import { renderBroadcastTemplate } from "./broadcast-template-renderer";
import {
  BroadcastTemplateNameConflictError,
  type BroadcastRecipient,
  type BroadcastSlotRow,
  BroadcastsRepository
} from "./broadcasts.repository";

/** Default audience preserves T2.4: every active client. */
const DEFAULT_AUDIENCE: BroadcastAudience = { kind: "all" };

/**
 * Owns free-slot broadcast logic (T2.4). Both operations are admin-only, gated
 * here by ADMIN_TELEGRAM_IDS via isAdmin — never in the controller or bot. The
 * broadcast only advertises bookable slots: every candidate row is re-asserted
 * with isBookable (status open + free seats) at BOTH preview and send time, so a
 * full/cancelled training is never advertised. The broadcast never creates a
 * booking; each slot line carries a `book:slot:<trainingId>` inline button that
 * funnels into the existing single-booking flow (T1.8), which re-checks
 * availability. Send writes exactly one broadcasts row.
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly repo: BroadcastsRepository,
    private readonly sender: TelegramSender,
    @Inject(ENV) private readonly env: Env
  ) {}

  /**
   * Admin: compose the preview for `type` and `audience`. Does NOT write. The
   * reported recipientsCount is the resolved segment size (so it matches exactly
   * what send would dispatch). Absent audience ⇒ all active clients (T2.4).
   */
  async preview(
    actorTelegramId: number,
    type: BroadcastType,
    audience: BroadcastAudience = DEFAULT_AUDIENCE,
    templateId?: string
  ): Promise<BroadcastPreview> {
    this.assertAdmin(actorTelegramId);

    const slots = await this.selectBookableSlots(type);
    const template = templateId ? await this.loadTemplateForType(templateId, type) : undefined;
    const text = this.render(type, slots, template);
    const recipients = await this.resolveRecipients(audience);

    return broadcastPreviewSchema.parse({
      type,
      text,
      slots,
      recipientsCount: recipients.length,
      ...(template
        ? {
            templateId: template.id,
            templateVersion: template.version,
            previewToken: signBroadcastPreviewToken(
              {
                actorTelegramId,
                type,
                audience,
                templateId: template.id,
                templateVersion: template.version
              },
              this.env.ADMIN_SESSION_SECRET
            ),
            templateVariables: BROADCAST_TEMPLATE_VARIABLES
          }
        : {})
    });
  }

  /**
   * Admin: re-run selection at send time (slots can have gone full since
   * preview), resolve the audience segment, fan out with a per-slot inline
   * button, and insert exactly one broadcasts row (payload = composed text,
   * createdBy = admin telegramId, recipientsCount = the resolved segment size,
   * i.e. the count actually dispatched). The audience is also recorded in the
   * payload for audit. A per-recipient Telegram failure is logged and tolerated;
   * the broadcasts row is still written.
   */
  async send(
    actorTelegramId: number,
    type: BroadcastType,
    audience: BroadcastAudience = DEFAULT_AUDIENCE,
    templateId?: string,
    previewToken?: string
  ): Promise<Broadcast> {
    this.assertAdmin(actorTelegramId);

    const template = templateId ? await this.loadTemplateForType(templateId, type) : undefined;
    if (template) {
      if (!previewToken) {
        throw new BadRequestException("previewToken is required when templateId is provided");
      }
      this.assertPreviewToken(previewToken, {
        actorTelegramId,
        type,
        audience,
        templateId: template.id,
        templateVersion: template.version
      });
    }

    const slots = await this.selectBookableSlots(type);
    const text = this.render(type, slots, template);
    const buttons: BookSlotButton[] = slots.map((s) => ({
      trainingId: s.trainingId,
      startTime: s.startTime,
      groupName: s.groupName,
      levelName: s.levelName
    }));
    const recipients = await this.resolveRecipients(audience);

    for (const recipient of recipients) {
      try {
        // Localize each per-slot button (TIME + LEVEL) to the recipient's language; the
        // body stays RU and the book:slot:<id> callback_data is identical across locales.
        const replyMarkup = bookSlotsKeyboard(recipient.language, buttons);
        await this.sender.sendMessage(recipient.telegramId, text, replyMarkup);
      } catch (error) {
        this.logger.error(
          `Broadcast ${type} to ${recipient.telegramId} failed: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    return this.repo.insertBroadcast({
      type,
      payload: text,
      createdBy: actorTelegramId,
      recipientsCount: recipients.length
    });
  }

  /** Admin: active templates for one broadcast type. */
  async listTemplates(
    actorTelegramId: number,
    type: BroadcastType
  ): Promise<BroadcastTemplate[]> {
    this.assertAdmin(actorTelegramId);
    return this.repo.listTemplates(type);
  }

  /** Admin: create a strict-placeholder broadcast template. */
  async createTemplate(
    actorTelegramId: number,
    input: CreateBroadcastTemplateInput
  ): Promise<BroadcastTemplate> {
    this.assertAdmin(actorTelegramId);
    const parsed = validateTemplateInput(createBroadcastTemplateSchema, input);
    this.assertKnownPlaceholders(parsed);
    try {
      return broadcastTemplateSchema.parse(await this.repo.createTemplate(parsed, actorTelegramId));
    } catch (error) {
      this.throwIfTemplateNameConflict(error);
      throw error;
    }
  }

  /** Admin: patch a template and bump version. */
  async updateTemplate(
    actorTelegramId: number,
    id: string,
    input: UpdateBroadcastTemplateInput
  ): Promise<BroadcastTemplate> {
    this.assertAdmin(actorTelegramId);
    const parsed = validateTemplateInput(updateBroadcastTemplateSchema, input);
    this.assertKnownPlaceholders(parsed);
    let updated: BroadcastTemplate | undefined;
    try {
      updated = await this.repo.updateTemplate(id, parsed, actorTelegramId);
    } catch (error) {
      this.throwIfTemplateNameConflict(error);
      throw error;
    }
    if (!updated) {
      throw new NotFoundException("Broadcast template not found");
    }
    return broadcastTemplateSchema.parse(updated);
  }

  /** Admin: the server-owned variables available to broadcast templates. */
  variables(actorTelegramId: number, _type: BroadcastType): BroadcastTemplateVariable[] {
    this.assertAdmin(actorTelegramId);
    return [...BROADCAST_TEMPLATE_VARIABLES];
  }

  /**
   * Select the bookable slot cards for `type` (Europe/Belgrade dates). Reads the
   * candidate rows for the date window, re-asserts isBookable, and maps to slot
   * cards with server-side free seats / price. "freed-up" is, for this slice,
   * the upcoming-bookable set (no was-full-now-open tracking yet — see the brief).
   */
  private async selectBookableSlots(type: BroadcastType): Promise<SlotCard[]> {
    const today = belgradeToday();
    const { from, to } = windowFor(type, today);
    const rows = await this.repo.listSlots(from, to);

    return rows.filter((row) => isBookable(row)).map((row) => toSlotCard(row));
  }

  /**
   * Resolve an audience segment to a concrete recipient list via the repo (the
   * only DB access). A segment can only ever *narrow* the active-client base:
   * recipients are always active clients. `active`/`lapsed` use a rolling cutoff
   * of now − days. This is the single place the audience → recipients mapping
   * lives, so preview and send always agree.
   */
  resolveRecipients(audience: BroadcastAudience): Promise<BroadcastRecipient[]> {
    switch (audience.kind) {
      case "all":
        return this.repo.listActiveRecipients();
      case "level":
        return this.repo.listActiveRecipientsByLevel(audience.levelId);
      case "active":
        return this.repo.listActiveRecipientsBookedSince(cutoffDaysAgo(audience.days));
      case "lapsed":
        return this.repo.listActiveRecipientsNotBookedSince(cutoffDaysAgo(audience.days));
      default: {
        const exhaustive: never = audience;
        throw new ForbiddenException(`Unsupported audience ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin privileges required");
    }
  }

  private async loadTemplateForType(id: string, type: BroadcastType): Promise<BroadcastTemplate> {
    const template = await this.repo.findActiveTemplate(id);
    if (!template || template.broadcastType !== type) {
      throw new NotFoundException("Broadcast template not found");
    }
    this.assertKnownPlaceholders(template);
    return template;
  }

  private render(
    type: BroadcastType,
    slots: SlotCard[],
    template: BroadcastTemplate | undefined
  ): string {
    return template ? renderBroadcastTemplate(template, slots) : composeBroadcastText(type, slots);
  }

  private assertKnownPlaceholders(input: {
    bodyTemplate?: string;
    slotLineTemplate?: string;
    emptyBodyTemplate?: string;
  }): void {
    const unknown = [
      ...(input.bodyTemplate ? findUnknownBroadcastTemplatePlaceholders(input.bodyTemplate) : []),
      ...(input.slotLineTemplate
        ? findUnknownBroadcastTemplatePlaceholders(input.slotLineTemplate)
        : []),
      ...(input.emptyBodyTemplate
        ? findUnknownBroadcastTemplatePlaceholders(input.emptyBodyTemplate)
        : [])
    ];
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown broadcast template placeholder: ${Array.from(new Set(unknown)).join(", ")}`
      );
    }
  }

  private throwIfTemplateNameConflict(error: unknown): void {
    if (error instanceof BroadcastTemplateNameConflictError) {
      throw new ConflictException("Active broadcast template name already exists for this type");
    }
  }

  private assertPreviewToken(
    token: string,
    expected: {
      actorTelegramId: number;
      type: BroadcastType;
      audience: BroadcastAudience;
      templateId: string;
      templateVersion: number;
    }
  ): void {
    const result = verifyBroadcastPreviewToken(token, expected, this.env.ADMIN_SESSION_SECRET);
    if (result.ok) {
      return;
    }
    if (result.problem === "version-stale") {
      throw new ConflictException("Broadcast template changed; preview again before sending");
    }
    throw new BadRequestException(messageForTokenProblem(result.problem));
  }
}

/** A Date `days` whole days before now — the rolling cutoff for active/lapsed. */
function cutoffDaysAgo(days: number): Date {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
}

/** The [from, to] date window for each broadcast type, anchored on today. */
function windowFor(type: BroadcastType, today: string): { from: string; to: string } {
  if (type === "today") {
    return { from: today, to: today };
  }
  if (type === "tomorrow") {
    const tomorrow = addDays(today, 1);
    return { from: tomorrow, to: tomorrow };
  }
  // "week" and "freed-up": today..today+6 (freed-up = upcoming-bookable for this slice).
  return { from: today, to: addDays(today, 6) };
}

/** Map a candidate row to the SlotCard contract (free seats computed here). */
function toSlotCard(row: BroadcastSlotRow): SlotCard {
  return {
    trainingId: row.trainingId,
    date: row.date,
    dayOfWeek: isoWeekdayOf(row.date),
    startTime: row.startTime,
    endTime: row.endTime,
    groupName: row.groupName,
    trainerName: row.trainerName,
    levelName: row.levelName,
    freeSeats: freeSeats(row),
    priceSingleRsd: row.priceSingleRsd
  };
}

function messageForTokenProblem(problem: BroadcastPreviewTokenProblem): string {
  switch (problem) {
    case "expired":
      return "Broadcast preview expired; preview again before sending";
    case "actor-mismatch":
    case "type-mismatch":
    case "audience-mismatch":
    case "template-mismatch":
      return "Broadcast preview token does not match this send request";
    case "invalid":
      return "Invalid broadcast preview token";
    case "version-stale":
      return "Broadcast template changed; preview again before sending";
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
}

function validateTemplateInput<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

/** Today's date in Europe/Belgrade as "YYYY-MM-DD". */
function belgradeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/** Add whole days to a "YYYY-MM-DD" date, returning the same ISO format. */
function addDays(isoDate: string, days: number): string {
  const cursor = new Date(`${isoDate}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}
