import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Client, Level } from "@beosand/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsService } from "./clients.service";
import type { ClientsRepository } from "./clients.repository";
import type { LevelsRepository } from "../levels/levels.repository";
import type { StaffLinkingService } from "../managers/staff-linking.service";
import type { DatabaseService } from "../../db/database.service";

const TELEGRAM_ID = 4242;
const ADMIN_ID = 9999;
const LEVEL_ID = "11111111-1111-1111-1111-111111111111";
const PHOTO_URL = "https://t.me/i/userpic/320/ana.jpg";

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

const existingClient: Client = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Ana",
  telegramId: TELEGRAM_ID,
  telegramUsername: "ana",
  telegramPhotoUrl: PHOTO_URL,
  levelId: LEVEL_ID,
  source: "telegram",
  phone: null,
  email: null,
  note: null,
  language: "ru",
  registeredAt: "2026-01-01T00:00:00.000Z",
  consentGivenAt: null,
  status: "active",
  bonusTrainingCredits: 0
};

const walkInClient: Client = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Marko",
  telegramId: null,
  telegramUsername: null,
  telegramPhotoUrl: null,
  levelId: null,
  source: "walk_in",
  phone: "+381601234567",
  email: null,
  note: "via Instagram",
  language: "ru",
  registeredAt: "2026-01-01T00:00:00.000Z",
  consentGivenAt: null,
  status: "active",
  bonusTrainingCredits: 0
};

const beginner: Level = { id: LEVEL_ID, name: "Beginner", status: "active" };

// The service runs its read-or-insert inside db.transaction; the fake just
// invokes the callback with a stub tx so the repo mocks receive a handle.
function makeDatabase(): DatabaseService {
  const tx = {} as never;
  return {
    db: {
      transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx))
    }
  } as unknown as DatabaseService;
}

function makeClientsRepo(overrides: Partial<ClientsRepository> = {}): ClientsRepository {
  return {
    findByTelegramId: vi.fn(async () => undefined),
    findAll: vi.fn(async () => [existingClient]),
    insertIgnoreConflict: vi.fn(async (values: { telegramId: number; name: string; levelId: string | null; telegramUsername: string | null; telegramPhotoUrl?: string | null }) => ({
      ...existingClient,
      name: values.name,
      telegramUsername: values.telegramUsername,
      telegramPhotoUrl: values.telegramPhotoUrl ?? null,
      levelId: values.levelId
    })),
    updateLanguage: vi.fn(async (telegramId: number, language: "ru" | "sr" | "en") => ({
      ...existingClient,
      telegramId,
      language
    })),
    insertWalkIn: vi.fn(async (values: { name: string; phone?: string; note?: string }) => ({
      ...walkInClient,
      name: values.name,
      phone: values.phone ?? null,
      note: values.note ?? null
    })),
    findById: vi.fn(async () => existingClient),
    updateById: vi.fn(async (id: string, patch: Partial<Client>) => ({
      ...existingClient,
      id,
      ...patch
    })),
    // Mirror the repo's atomic floored-at-zero clamp: GREATEST(0, current + delta).
    adjustBonusCredits: vi.fn(async (id: string, delta: number) => ({
      ...existingClient,
      id,
      bonusTrainingCredits: Math.max(0, existingClient.bonusTrainingCredits + delta)
    })),
    syncTelegramDisplayIdentity: vi.fn(
      async (
        telegramId: number,
        identity: { telegramUsername: string | null; telegramPhotoUrl: string | null }
      ) => ({
        ...existingClient,
        telegramId,
        telegramUsername: identity.telegramUsername,
        telegramPhotoUrl: identity.telegramPhotoUrl
      })
    ),
    ...overrides
  } as unknown as ClientsRepository;
}

function makeLevelsRepo(overrides: Partial<LevelsRepository> = {}): LevelsRepository {
  return {
    findById: vi.fn(async () => beginner),
    ...overrides
  } as unknown as LevelsRepository;
}

/** Staff linking is exercised in its own spec; here a no-op satisfies the ctor. */
function makeStaffLinking(): StaffLinkingService {
  return { linkPendingStaff: vi.fn(async () => undefined) } as unknown as StaffLinkingService;
}

describe("ClientsService", () => {
  let clientsRepo: ClientsRepository;
  let levelsRepo: LevelsRepository;
  let service: ClientsService;

  beforeEach(() => {
    clientsRepo = makeClientsRepo();
    levelsRepo = makeLevelsRepo();
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
  });

  it("404s when no client exists for the telegram id", async () => {
    await expect(service.getByTelegramId(TELEGRAM_ID, TELEGRAM_ID)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("returns the client when one exists", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    await expect(service.getByTelegramId(TELEGRAM_ID, TELEGRAM_ID)).resolves.toEqual(existingClient);
  });

  it("syncs verified Mini App display identity before returning a self read", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);

    const result = await service.getByTelegramId(TELEGRAM_ID, TELEGRAM_ID, {
      telegramUsername: "ana_new",
      telegramPhotoUrl: "https://t.me/i/userpic/320/ana-new.jpg"
    });

    expect(result.telegramUsername).toBe("ana_new");
    expect(result.telegramPhotoUrl).toBe("https://t.me/i/userpic/320/ana-new.jpg");
    expect(clientsRepo.syncTelegramDisplayIdentity).toHaveBeenCalledWith(
      TELEGRAM_ID,
      {
        telegramUsername: "ana_new",
        telegramPhotoUrl: "https://t.me/i/userpic/320/ana-new.jpg"
      },
      undefined
    );
  });

  it("clears stale username/photo when verified Mini App identity omits them", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);

    const result = await service.getByTelegramId(TELEGRAM_ID, TELEGRAM_ID, {
      telegramUsername: null,
      telegramPhotoUrl: null
    });

    expect(result.telegramUsername).toBeNull();
    expect(result.telegramPhotoUrl).toBeNull();
  });

  it("forbids reading another client's record (no DB read)", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    await expect(service.getByTelegramId(TELEGRAM_ID, 1111)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(clientsRepo.findByTelegramId).not.toHaveBeenCalled();
  });

  it("lets an admin read any client's record", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    await expect(service.getByTelegramId(ADMIN_ID, TELEGRAM_ID)).resolves.toEqual(existingClient);
  });

  it("does not let a Mini App client-session identity use admin fallback for another client", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);

    await expect(
      service.getByTelegramId(ADMIN_ID, TELEGRAM_ID, {
        telegramUsername: "admin",
        telegramPhotoUrl: PHOTO_URL
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(clientsRepo.findByTelegramId).not.toHaveBeenCalled();
  });

  it("inserts a new client on first onboard", async () => {
    const result = await service.onboard(TELEGRAM_ID, {
      telegramId: TELEGRAM_ID,
      name: "Ana",
      levelId: LEVEL_ID
    });
    expect(result.name).toBe("Ana");
    expect(clientsRepo.insertIgnoreConflict).toHaveBeenCalledOnce();
  });

  it("forbids onboarding a record for a different telegram id (account squatting), inserts nothing", async () => {
    await expect(
      service.onboard(TELEGRAM_ID, { telegramId: 1111, name: "Victim" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(clientsRepo.insertIgnoreConflict).not.toHaveBeenCalled();
  });

  it("is idempotent: a second onboard returns the existing row and inserts nothing", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    const result = await service.onboard(TELEGRAM_ID, {
      telegramId: TELEGRAM_ID,
      name: "Different Name",
      levelId: null
    });
    expect(result).toEqual(existingClient);
    expect(clientsRepo.insertIgnoreConflict).not.toHaveBeenCalled();
  });

  it("persists null level for the 'Не знаю' case (levelId null)", async () => {
    const result = await service.onboard(TELEGRAM_ID, {
      telegramId: TELEGRAM_ID,
      name: "Ana",
      levelId: null
    });
    expect(result.levelId).toBeNull();
    expect(levelsRepo.findById).not.toHaveBeenCalled();
  });

  it("persists null level when levelId is omitted", async () => {
    const result = await service.onboard(TELEGRAM_ID, { telegramId: TELEGRAM_ID, name: "Ana" });
    expect(result.levelId).toBeNull();
  });

  it("omits username to null when not provided (user without a username)", async () => {
    const result = await service.onboard(TELEGRAM_ID, { telegramId: TELEGRAM_ID, name: "Ana" });
    expect(result.telegramUsername).toBeNull();
  });

  it("inserts verified Mini App username/photo on first onboard", async () => {
    const result = await service.onboard(
      TELEGRAM_ID,
      {
        telegramId: TELEGRAM_ID,
        name: "Ana",
        levelId: LEVEL_ID
      },
      {
        telegramUsername: "verified_ana",
        telegramPhotoUrl: "https://t.me/i/userpic/320/verified.jpg"
      }
    );

    expect(result.telegramUsername).toBe("verified_ana");
    expect(result.telegramPhotoUrl).toBe("https://t.me/i/userpic/320/verified.jpg");
    expect(clientsRepo.insertIgnoreConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramUsername: "verified_ana",
        telegramPhotoUrl: "https://t.me/i/userpic/320/verified.jpg"
      }),
      expect.anything()
    );
  });

  it("does not trust body username when verified Mini App identity omits it on first onboard", async () => {
    const result = await service.onboard(
      TELEGRAM_ID,
      {
        telegramId: TELEGRAM_ID,
        name: "Ana",
        telegramUsername: "forged_body_username"
      },
      {
        telegramUsername: null,
        telegramPhotoUrl: null
      }
    );

    expect(result.telegramUsername).toBeNull();
    expect(result.telegramPhotoUrl).toBeNull();
    expect(clientsRepo.insertIgnoreConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramUsername: null,
        telegramPhotoUrl: null
      }),
      expect.anything()
    );
  });

  it("syncs existing onboard identity without changing name/level/consent/language/admin fields", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);

    const result = await service.onboard(
      TELEGRAM_ID,
      {
        telegramId: TELEGRAM_ID,
        name: "Different Name",
        levelId: null
      },
      {
        telegramUsername: null,
        telegramPhotoUrl: null
      }
    );

    expect(result).toMatchObject({
      id: existingClient.id,
      name: existingClient.name,
      levelId: existingClient.levelId,
      consentGivenAt: existingClient.consentGivenAt,
      language: existingClient.language,
      phone: existingClient.phone,
      email: existingClient.email,
      note: existingClient.note,
      status: existingClient.status,
      bonusTrainingCredits: existingClient.bonusTrainingCredits,
      telegramUsername: null,
      telegramPhotoUrl: null
    });
    expect(clientsRepo.syncTelegramDisplayIdentity).toHaveBeenCalledWith(
      TELEGRAM_ID,
      { telegramUsername: null, telegramPhotoUrl: null },
      expect.anything()
    );
    expect(clientsRepo.insertIgnoreConflict).not.toHaveBeenCalled();
  });

  it("does not clear an existing photo on bot/admin onboard without verified Mini App identity", async () => {
    clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);

    const result = await service.onboard(TELEGRAM_ID, {
      telegramId: TELEGRAM_ID,
      name: "Different Name"
    });

    expect(result.telegramPhotoUrl).toBe(PHOTO_URL);
    expect(clientsRepo.syncTelegramDisplayIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unknown levelId and inserts nothing", async () => {
    levelsRepo = makeLevelsRepo({ findById: vi.fn(async () => undefined) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    await expect(
      service.onboard(TELEGRAM_ID, { telegramId: TELEGRAM_ID, name: "Ana", levelId: LEVEL_ID })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(clientsRepo.insertIgnoreConflict).not.toHaveBeenCalled();
  });

  it("rejects an inactive levelId and inserts nothing", async () => {
    levelsRepo = makeLevelsRepo({
      findById: vi.fn(async () => ({ ...beginner, status: "inactive" }) as Level)
    });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    await expect(
      service.onboard(TELEGRAM_ID, { telegramId: TELEGRAM_ID, name: "Ana", levelId: LEVEL_ID })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(clientsRepo.insertIgnoreConflict).not.toHaveBeenCalled();
  });

  it("returns the racer's row when a concurrent tap won the insert", async () => {
    const findByTelegramId = vi
      .fn(async (): Promise<Client | undefined> => undefined)
      .mockResolvedValueOnce(undefined) // initial read inside tx: no row yet
      .mockResolvedValueOnce(existingClient); // re-read after conflict
    clientsRepo = makeClientsRepo({
      findByTelegramId,
      insertIgnoreConflict: vi.fn(async () => undefined) // conflict: another tap inserted
    });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    const result = await service.onboard(TELEGRAM_ID, { telegramId: TELEGRAM_ID, name: "Ana" });
    expect(result).toEqual(existingClient);
  });

  it("forbids a non-admin from listing clients and never queries", async () => {
    await expect(service.listClients(TELEGRAM_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(clientsRepo.findAll).not.toHaveBeenCalled();
  });

  it("lets an admin list all clients", async () => {
    await expect(service.listClients(ADMIN_ID)).resolves.toEqual([existingClient]);
    expect(clientsRepo.findAll).toHaveBeenCalledWith({ search: undefined, status: undefined });
  });

  it("strips a leading @ from the search before querying", async () => {
    await service.listClients(ADMIN_ID, { search: "@Ana" });
    expect(clientsRepo.findAll).toHaveBeenCalledWith({ search: "Ana", status: undefined });
  });

  it("treats a blank/whitespace search as no filter", async () => {
    await service.listClients(ADMIN_ID, { search: "   " });
    expect(clientsRepo.findAll).toHaveBeenCalledWith({ search: undefined, status: undefined });
  });

  it("passes the status filter through to the repository", async () => {
    await service.listClients(ADMIN_ID, { status: "inactive" });
    expect(clientsRepo.findAll).toHaveBeenCalledWith({ search: undefined, status: "inactive" });
  });

  it("sets the caller's own language", async () => {
    const result = await service.setLanguage(TELEGRAM_ID, TELEGRAM_ID, "sr");
    expect(result.language).toBe("sr");
    expect(clientsRepo.updateLanguage).toHaveBeenCalledWith(TELEGRAM_ID, "sr");
  });

  it("sets the caller's own language from a client session", async () => {
    const result = await service.setLanguage(TELEGRAM_ID, TELEGRAM_ID, "sr", true);
    expect(result.language).toBe("sr");
    expect(clientsRepo.updateLanguage).toHaveBeenCalledWith(TELEGRAM_ID, "sr");
  });

  it("forbids setting another client's language and writes nothing", async () => {
    await expect(service.setLanguage(TELEGRAM_ID, 1111, "en")).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(clientsRepo.updateLanguage).not.toHaveBeenCalled();
  });

  it("forbids an admin Telegram id from a client session changing another client's language", async () => {
    await expect(service.setLanguage(ADMIN_ID, TELEGRAM_ID, "en", true)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(clientsRepo.updateLanguage).not.toHaveBeenCalled();
  });

  it("lets an admin set any client's language", async () => {
    const result = await service.setLanguage(ADMIN_ID, TELEGRAM_ID, "en");
    expect(result.language).toBe("en");
  });

  it("404s when setting language for a missing client", async () => {
    clientsRepo = makeClientsRepo({ updateLanguage: vi.fn(async () => undefined) });
    service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
    await expect(service.setLanguage(TELEGRAM_ID, TELEGRAM_ID, "sr")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  describe("createWalkIn (Feature 5)", () => {
    it("lets an admin create a walk-in with telegram_id null and source walk_in", async () => {
      const result = await service.createWalkIn(ADMIN_ID, { name: "Marko", phone: "+381" });
      expect(result.telegramId).toBeNull();
      expect(result.source).toBe("walk_in");
      expect(result.name).toBe("Marko");
      expect(clientsRepo.insertWalkIn).toHaveBeenCalledWith({ name: "Marko", phone: "+381" });
    });

    it("forbids a non-admin and inserts nothing (403)", async () => {
      await expect(service.createWalkIn(TELEGRAM_ID, { name: "Marko" })).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(clientsRepo.insertWalkIn).not.toHaveBeenCalled();
    });
  });

  describe("updateClient (admin-only profile edit)", () => {
    const CLIENT_ID = existingClient.id;

    it("forbids a non-admin and writes nothing (403)", async () => {
      await expect(
        service.updateClient(TELEGRAM_ID, CLIENT_ID, { name: "New" })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(clientsRepo.findById).not.toHaveBeenCalled();
      expect(clientsRepo.updateById).not.toHaveBeenCalled();
    });

    it("404s a missing client and writes nothing", async () => {
      clientsRepo = makeClientsRepo({ findById: vi.fn(async () => undefined) });
      service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
      await expect(
        service.updateClient(ADMIN_ID, CLIENT_ID, { name: "New" })
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(clientsRepo.updateById).not.toHaveBeenCalled();
    });

    it("rejects an unknown levelId and writes nothing (400)", async () => {
      levelsRepo = makeLevelsRepo({ findById: vi.fn(async () => undefined) });
      service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
      await expect(
        service.updateClient(ADMIN_ID, CLIENT_ID, { levelId: LEVEL_ID })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(clientsRepo.updateById).not.toHaveBeenCalled();
    });

    it("rejects an inactive levelId and writes nothing (400)", async () => {
      levelsRepo = makeLevelsRepo({
        findById: vi.fn(async () => ({ ...beginner, status: "inactive" }) as Level)
      });
      service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
      await expect(
        service.updateClient(ADMIN_ID, CLIENT_ID, { levelId: LEVEL_ID })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(clientsRepo.updateById).not.toHaveBeenCalled();
    });

    it("returns the existing row unchanged for an empty patch and never writes", async () => {
      const result = await service.updateClient(ADMIN_ID, CLIENT_ID, {});
      expect(result).toEqual(existingClient);
      expect(clientsRepo.updateById).not.toHaveBeenCalled();
      // A null clearing levelId is never re-validated against levels for an empty patch.
      expect(levelsRepo.findById).not.toHaveBeenCalled();
    });

    it("persists the patch and returns the updated client (happy path)", async () => {
      const patch = { name: "Ana Renamed", phone: "+381601112233", note: "VIP" };
      const result = await service.updateClient(ADMIN_ID, CLIENT_ID, patch);
      expect(clientsRepo.updateById).toHaveBeenCalledWith(CLIENT_ID, patch);
      expect(result).toMatchObject(patch);
    });

    it("clears a nullable field by passing null straight to the repo (no level check)", async () => {
      const patch = { levelId: null, note: null };
      await service.updateClient(ADMIN_ID, CLIENT_ID, patch);
      // levelId === null clears the column; it must not be validated as an active level.
      expect(levelsRepo.findById).not.toHaveBeenCalled();
      expect(clientsRepo.updateById).toHaveBeenCalledWith(CLIENT_ID, patch);
    });
  });

  describe("adjustBonusCredits (admin-only bonus adjustment)", () => {
    const CLIENT_ID = existingClient.id;

    /** A repo double whose floored clamp starts from `start` (GREATEST(0, start+delta)). */
    function repoWithBalance(start: number): ClientsRepository {
      return makeClientsRepo({
        adjustBonusCredits: vi.fn(async (id: string, delta: number) => ({
          ...existingClient,
          id,
          bonusTrainingCredits: Math.max(0, start + delta)
        }))
      });
    }

    it("forbids a non-admin and writes nothing (403)", async () => {
      await expect(
        service.adjustBonusCredits(TELEGRAM_ID, CLIENT_ID, { delta: 1 })
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(clientsRepo.adjustBonusCredits).not.toHaveBeenCalled();
    });

    it("increases the balance for a positive delta and returns the updated client", async () => {
      clientsRepo = repoWithBalance(1);
      service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
      const result = await service.adjustBonusCredits(ADMIN_ID, CLIENT_ID, {
        delta: 2,
        reason: "make-good"
      });
      expect(result.bonusTrainingCredits).toBe(3);
      expect(clientsRepo.adjustBonusCredits).toHaveBeenCalledWith(CLIENT_ID, 2);
    });

    it("floors a debit at zero (balance 2, delta -5 → 0), never negative", async () => {
      clientsRepo = repoWithBalance(2);
      service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
      const result = await service.adjustBonusCredits(ADMIN_ID, CLIENT_ID, { delta: -5 });
      expect(result.bonusTrainingCredits).toBe(0);
    });

    it("404s a missing client", async () => {
      clientsRepo = makeClientsRepo({ adjustBonusCredits: vi.fn(async () => undefined) });
      service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
      await expect(
        service.adjustBonusCredits(ADMIN_ID, CLIENT_ID, { delta: 1 })
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // The personal-data-processing consent timestamp is stamped server-side (never
  // from a client clock) and ONLY on the first insert: a returning client keeps
  // its original (or null) value, and an admin walk-in is never asked to consent.
  describe("consent (personal-data-processing)", () => {
    it("stamps consentGivenAt (a Date) into the insert on first onboard", async () => {
      await service.onboard(TELEGRAM_ID, {
        telegramId: TELEGRAM_ID,
        name: "Ana",
        levelId: LEVEL_ID
      });
      const insertArg = (clientsRepo.insertIgnoreConflict as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as { consentGivenAt: unknown };
      expect(insertArg.consentGivenAt).toBeInstanceOf(Date);
      expect(insertArg.consentGivenAt).not.toBeNull();
    });

    it("does NOT stamp consent for a returning client (insert path not taken)", async () => {
      clientsRepo = makeClientsRepo({ findByTelegramId: vi.fn(async () => existingClient) });
      service = new ClientsService(clientsRepo, levelsRepo, makeDatabase(), makeStaffLinking(), env);
      const result = await service.onboard(TELEGRAM_ID, {
        telegramId: TELEGRAM_ID,
        name: "Different Name"
      });
      // Returned unchanged, and the row's consent is never re-written.
      expect(result.consentGivenAt).toBe(existingClient.consentGivenAt);
      expect(result.consentGivenAt).toBeNull();
      expect(clientsRepo.insertIgnoreConflict).not.toHaveBeenCalled();
    });

    it("leaves consentGivenAt null for an admin walk-in (insertWalkIn never stamps it)", async () => {
      const result = await service.createWalkIn(ADMIN_ID, { name: "Marko", phone: "+381601234567" });
      expect(result.consentGivenAt).toBeNull();
    });
  });
});
