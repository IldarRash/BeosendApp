import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { Env } from "@beosand/config";
import { isAdmin } from "@beosand/config";
import type {
  Client,
  CreateWalkInInput,
  ListClientsQuery,
  Locale,
  UpdateClientInput
} from "@beosand/types";
import { ENV } from "../../config/config.module";
import { DatabaseService } from "../../db/database.service";
import { LevelsRepository } from "../levels/levels.repository";
import { StaffLinkingService } from "../managers/staff-linking.service";
import { ClientsRepository } from "./clients.repository";

interface OnboardInput {
  telegramId: number;
  telegramUsername?: string | null;
  name: string;
  levelId?: string | null;
}

/**
 * Owns client domain logic. Identity is the numeric telegram_id, resolved from
 * the x-telegram-id header by the controller. A client only reads/writes its own
 * record (actor === target); ADMIN_TELEGRAM_IDS may act on any. Onboarding is
 * idempotent on telegram_id: an existing client is returned unchanged (its name
 * and level are never overwritten), backed by the telegram_id unique index so
 * two concurrent /start taps cannot create a duplicate row, and so an attacker
 * cannot pre-seed a victim's record (actor must match the onboarded id).
 */
@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly levels: LevelsRepository,
    private readonly database: DatabaseService,
    private readonly staffLinking: StaffLinkingService,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Bot branches new-user vs returning-user on this 404 vs 200. */
  async getByTelegramId(actorTelegramId: number, targetTelegramId: number): Promise<Client> {
    this.assertSelfOrAdmin(actorTelegramId, targetTelegramId);
    const client = await this.clients.findByTelegramId(targetTelegramId);
    if (!client) {
      throw new NotFoundException(`Client with telegram_id ${targetTelegramId} not found`);
    }
    return client;
  }

  /**
   * Admin-only: the full clients list for the console, optionally filtered by a
   * name/@username search and status. The search is normalized here — a leading
   * "@" is dropped and blank means "no filter" — so the repository only queries.
   */
  async listClients(
    actorTelegramId: number,
    filters: ListClientsQuery = {}
  ): Promise<Client[]> {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Only an admin may list clients");
    }
    return this.clients.findAll({
      search: normalizeSearch(filters.search),
      status: filters.status
    });
  }

  async onboard(actorTelegramId: number, input: OnboardInput): Promise<Client> {
    this.assertSelfOrAdmin(actorTelegramId, input.telegramId);

    if (input.levelId != null) {
      const level = await this.levels.findById(input.levelId);
      if (!level || level.status !== "active") {
        throw new BadRequestException(`Level ${input.levelId} is unknown or inactive`);
      }
    }

    const client = await this.database.db.transaction(async (tx) => {
      const existing = await this.clients.findByTelegramId(input.telegramId, tx);
      if (existing) {
        return existing;
      }

      const inserted = await this.clients.insertIgnoreConflict(
        {
          telegramId: input.telegramId,
          telegramUsername: input.telegramUsername ?? null,
          name: input.name,
          levelId: input.levelId ?? null
        },
        tx
      );
      if (inserted) {
        this.logger.log(`Onboarded client telegram_id=${input.telegramId}`);
        return inserted;
      }

      // A concurrent tap won the insert; re-read the row it created.
      const raced = await this.clients.findByTelegramId(input.telegramId, tx);
      if (!raced) {
        throw new BadRequestException("Failed to onboard client");
      }
      return raced;
    });

    // First bot contact links any trainer/manager added by this @username to the
    // now-known numeric id (idempotent; never blocks onboarding on failure).
    await this.staffLinking.linkPendingStaff(input.telegramId, input.telegramUsername);
    return client;
  }

  /**
   * Set a client's per-user UI locale (the bot's /language flow). Only the
   * client itself (or an admin) may change a record's language.
   */
  async setLanguage(
    actorTelegramId: number,
    targetTelegramId: number,
    language: Locale
  ): Promise<Client> {
    this.assertSelfOrAdmin(actorTelegramId, targetTelegramId);
    const updated = await this.clients.updateLanguage(targetTelegramId, language);
    if (!updated) {
      throw new NotFoundException(`Client with telegram_id ${targetTelegramId} not found`);
    }
    this.logger.log(`Set language=${language} for client telegram_id=${targetTelegramId}`);
    return updated;
  }

  /**
   * Create a walk-in client by name (Feature 5): no Telegram account, source
   * "walk_in", optional phone/note. Admin-only — a walk-in is an admin-created
   * record, never self-served. The booking of that walk-in onto a training is a
   * separate, admin-or-trainer action (BookingsService.createManual).
   */
  async createWalkIn(actorTelegramId: number, input: CreateWalkInInput): Promise<Client> {
    this.assertAdmin(actorTelegramId);
    const client = await this.clients.insertWalkIn(input);
    this.logger.log(`Created walk-in client ${client.id} (${client.name})`);
    return client;
  }

  /**
   * Admin-only (manager console): edit a client's profile by primary key, so
   * walk-ins (no telegram_id) are editable too. Only the provided keys are
   * written (a partial patch); a null clears a nullable column. A changed
   * `levelId` is validated against an active level, mirroring `onboard`. An empty
   * patch is a no-op (the existing row is returned unchanged), mirroring
   * GroupsService.update. Identity and the bot-owned language are not editable
   * here (the contract already omits them).
   */
  async updateClient(
    actorTelegramId: number,
    id: string,
    patch: UpdateClientInput
  ): Promise<Client> {
    this.assertAdmin(actorTelegramId);

    const existing = await this.clients.findById(id);
    if (!existing) {
      throw new NotFoundException(`Client ${id} not found`);
    }

    if (patch.levelId != null) {
      const level = await this.levels.findById(patch.levelId);
      if (!level || level.status !== "active") {
        throw new BadRequestException(`Level ${patch.levelId} is unknown or inactive`);
      }
    }

    if (Object.keys(patch).length === 0) {
      return existing;
    }

    const updated = await this.clients.updateById(id, patch);
    if (!updated) {
      throw new NotFoundException(`Client ${id} not found`);
    }
    this.logger.log(`Updated client ${id}`);
    return updated;
  }

  /** A client may only act on its own record; admins may act on any. */
  private assertSelfOrAdmin(actorTelegramId: number, targetTelegramId: number): void {
    if (actorTelegramId === targetTelegramId) {
      return;
    }
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Cannot act on another client's record");
    }
  }

  /** Admin-only guard for the manager surface (walk-in creation, clients list). */
  private assertAdmin(actorTelegramId: number): void {
    if (!isAdmin(this.env, actorTelegramId)) {
      throw new ForbiddenException("Admin only");
    }
  }
}

/**
 * Normalize a clients-list search term: drop a leading "@" (admins type "@handle"
 * but the column stores the bare username) and treat blank/whitespace as "no
 * filter". Returns undefined when nothing meaningful remains.
 */
function normalizeSearch(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.replace(/^@+/, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
