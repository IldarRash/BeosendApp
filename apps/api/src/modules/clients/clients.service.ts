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
import type { Client } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { DatabaseService } from "../../db/database.service";
import { LevelsRepository } from "../levels/levels.repository";
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

  async onboard(actorTelegramId: number, input: OnboardInput): Promise<Client> {
    this.assertSelfOrAdmin(actorTelegramId, input.telegramId);

    if (input.levelId != null) {
      const level = await this.levels.findById(input.levelId);
      if (!level || level.status !== "active") {
        throw new BadRequestException(`Level ${input.levelId} is unknown or inactive`);
      }
    }

    return this.database.db.transaction(async (tx) => {
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
}
