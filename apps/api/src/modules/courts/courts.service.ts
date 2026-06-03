import { ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import { isAdmin, type Env } from "@beosand/config";
import { courtSchema, type Court } from "@beosand/types";
import { ENV } from "../../config/config.module";
import { CourtsRepository } from "./courts.repository";

/**
 * Court reference is admin/internal only: GET /courts exposes court identities
 * (numbers), so every read is authorized server-side by telegram_id. Clients
 * never reach this — court numbers must never leak before admin confirmation.
 */
@Injectable()
export class CourtsService {
  private readonly logger = new Logger(CourtsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: CourtsRepository
  ) {}

  /** Active courts for an admin caller. Rejects non-admins before any DB read. */
  async listActiveCourts(callerTelegramId: number): Promise<Court[]> {
    if (!isAdmin(this.env, callerTelegramId)) {
      this.logger.warn(`Non-admin telegram_id ${callerTelegramId} attempted to list courts`);
      throw new ForbiddenException("Court identities are admin-only.");
    }

    const rows = await this.repository.findActive();
    return rows.map((row) => courtSchema.parse(row));
  }
}
