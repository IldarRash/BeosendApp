import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { setDbAdminIds } from "@beosand/config";
import { ManagersRepository } from "./managers.repository";

/**
 * Bridges the editable `managers` table into the synchronous `isAdmin(env, id)`
 * check. On boot and after every managers write (create/update/delete) or a
 * username→id link, it reloads the active managers' numeric ids and pushes them
 * into the process-level DB-admin set that `isAdmin` reads (see
 * `setDbAdminIds`). This keeps the admin check a single synchronous union of env
 * ids + DB ids without making the ~75 `isAdmin` call sites async or DB-aware.
 *
 * Best-effort and fail-open-to-env: a refresh failure is logged but never throws
 * into a request — admin authorization then falls back to the env list alone.
 */
@Injectable()
export class AdminRegistryService implements OnModuleInit {
  private readonly logger = new Logger(AdminRegistryService.name);

  constructor(private readonly managers: ManagersRepository) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** Reload active-manager ids from the DB into the synchronous admin set. */
  async refresh(): Promise<void> {
    try {
      const ids = await this.managers.listActiveTelegramIds();
      setDbAdminIds(ids);
    } catch (error) {
      this.logger.error(
        "Failed to refresh DB admin registry; admin authorization falls back to env ids: " +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }
}
