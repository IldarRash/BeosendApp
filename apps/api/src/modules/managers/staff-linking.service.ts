import { Injectable, Logger } from "@nestjs/common";
import { normalizeUsername } from "@beosand/types";
import { TrainersRepository } from "../trainers/trainers.repository";
import { AdminRegistryService } from "./admin-registry.service";
import { ManagersRepository } from "./managers.repository";

/**
 * Backfills the numeric Telegram id of staff (managers / trainers) added by
 * @username before their id was known. Called from the identity entry points that
 * carry a verified (id, username): admin Login Widget, Mini App auth, and bot
 * onboarding. Telegram does not expose username→id, so this "link on first
 * contact" is the only reliable moment to bind them.
 *
 * Best-effort: any failure is swallowed (logged) so it can never block a login /
 * onboard. When a MANAGER is linked, the synchronous admin registry is refreshed
 * so the new admin id is recognized for the rest of the request.
 */
@Injectable()
export class StaffLinkingService {
  private readonly logger = new Logger(StaffLinkingService.name);

  constructor(
    private readonly managers: ManagersRepository,
    private readonly trainers: TrainersRepository,
    private readonly registry: AdminRegistryService
  ) {}

  async linkPendingStaff(telegramId: number, username: string | null | undefined): Promise<void> {
    if (!username) {
      return;
    }
    const normalized = normalizeUsername(username);
    if (normalized.length === 0) {
      return;
    }
    try {
      const [manager] = await Promise.all([
        this.managers.linkByUsername(normalized, telegramId),
        this.trainers.linkByUsername(normalized, telegramId)
      ]);
      if (manager) {
        await this.registry.refresh();
      }
    } catch (error) {
      this.logger.warn(
        `Failed to link staff @${normalized} → ${telegramId}; continuing: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }
}
