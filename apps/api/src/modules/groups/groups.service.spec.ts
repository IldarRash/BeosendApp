import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { Client, CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { beforeEach, describe, expect, it } from "vitest";
import { GroupsService } from "./groups.service";
import type { GroupMemberRow, GroupsRepository } from "./groups.repository";
import type { ClientsRepository } from "../clients/clients.repository";
import type { CourtsRepository } from "../courts/courts.repository";
import type { TrainingsService } from "../trainings/trainings.service";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;
const COURT_ID = "44444444-4444-4444-4444-444444444444";

const baseInput: CreateGroupInput = {
  name: "Intermediate",
  levelId: "11111111-1111-1111-1111-111111111111",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "22222222-2222-2222-2222-222222222222",
  courtId: COURT_ID,
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 10000
};

/** In-memory stand-in for the Drizzle repository (only DB-access layer). */
class FakeGroupsRepository {
  private rows = new Map<string, Group>();
  private seq = 0;

  async listActive(): Promise<Group[]> {
    return [...this.rows.values()]
      .filter((g) => g.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<Group | undefined> {
    return this.rows.get(id);
  }

  async create(input: CreateGroupInput): Promise<Group> {
    const id = `00000000-0000-0000-0000-00000000000${++this.seq}`;
    const row: Group = { ...input, id, status: "active", trainerName: "Jovana", courtNumber: 1 };
    this.rows.set(id, row);
    return row;
  }

  async update(id: string, patch: UpdateGroupInput): Promise<Group | undefined> {
    const existing = this.rows.get(id);
    if (!existing) {
      return undefined;
    }
    const row: Group = { ...existing, ...patch };
    this.rows.set(id, row);
    return row;
  }

  async setInactive(id: string): Promise<Group | undefined> {
    const existing = this.rows.get(id);
    if (!existing) {
      return undefined;
    }
    const row: Group = { ...existing, status: "inactive" };
    this.rows.set(id, row);
    return row;
  }

  /** The month roster (distinct clients) the listMembers test supplies. */
  members: GroupMemberRow[] = [];
  async listMonthMembers(_groupId: string, _from: string, _to: string): Promise<GroupMemberRow[]> {
    return this.members;
  }
}

class FakeClientsRepository {
  client: Client | undefined;
  async findByTelegramId(telegramId: number): Promise<Client | undefined> {
    return this.client && this.client.telegramId === telegramId ? this.client : undefined;
  }
}

/** In-memory courts stand-in: the group's home court must be among these active. */
class FakeCourtsRepository {
  active: { id: string; number: number; status: "active" | "inactive" }[] = [
    { id: COURT_ID, number: 1, status: "active" }
  ];
  async findActive(): Promise<{ id: string; number: number; status: "active" | "inactive" }[]> {
    return this.active;
  }
}

/** In-memory stand-in for the trainings cascade the group soft-delete delegates to. */
class FakeTrainingsService {
  cancelledFor: { actorTelegramId: number; groupId: string }[] = [];
  cancelCount = 0;
  async cancelFutureTrainingsForGroup(actorTelegramId: number, groupId: string): Promise<number> {
    this.cancelledFor.push({ actorTelegramId, groupId });
    return this.cancelCount;
  }
}

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

describe("GroupsService", () => {
  let repo: FakeGroupsRepository;
  let clientsRepo: FakeClientsRepository;
  let courtsRepo: FakeCourtsRepository;
  let trainingsService: FakeTrainingsService;
  let service: GroupsService;

  beforeEach(() => {
    repo = new FakeGroupsRepository();
    clientsRepo = new FakeClientsRepository();
    courtsRepo = new FakeCourtsRepository();
    trainingsService = new FakeTrainingsService();
    service = new GroupsService(
      repo as unknown as GroupsRepository,
      clientsRepo as unknown as ClientsRepository,
      courtsRepo as unknown as CourtsRepository,
      trainingsService as unknown as TrainingsService,
      env
    );
  });

  it("admin create stores the group and it appears in listActive", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    expect(created.name).toBe("Intermediate");
    expect(created.status).toBe("active");
    expect(await service.listActive()).toContainEqual(created);
  });

  it("create stores the chosen home court", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    expect(created.courtId).toBe(COURT_ID);
  });

  it("rejects a create whose court is not active (400) and writes nothing", async () => {
    courtsRepo.active = []; // the chosen court is not among the active courts
    await expect(service.create(ADMIN_ID, baseInput)).rejects.toMatchObject({ status: 400 });
    expect(await service.listActive()).toHaveLength(0);
  });

  it("rejects a court change to an unknown court (400)", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    await expect(
      service.update(ADMIN_ID, created.id, { courtId: "55555555-5555-5555-5555-555555555555" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("allows a court change to another active court", async () => {
    const OTHER_COURT = "66666666-6666-6666-6666-666666666666";
    courtsRepo.active.push({ id: OTHER_COURT, number: 2, status: "active" });
    const created = await service.create(ADMIN_ID, baseInput);
    const updated = await service.update(ADMIN_ID, created.id, { courtId: OTHER_COURT });
    expect(updated.courtId).toBe(OTHER_COURT);
  });

  it("allows clearing the court (null reverts to auto-pick) without validation", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    courtsRepo.active = []; // even with no active court, clearing must not 400
    const updated = await service.update(ADMIN_ID, created.id, { courtId: null });
    expect(updated.courtId).toBeNull();
  });

  it("admin edit of capacity and price succeeds", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    const updated = await service.update(ADMIN_ID, created.id, {
      capacity: 8,
      priceMonthRsd: 12000
    });
    expect(updated.capacity).toBe(8);
    expect(updated.priceMonthRsd).toBe(12000);
  });

  it("rejects endTime <= startTime on create with a typed error", async () => {
    await expect(
      service.create(ADMIN_ID, { ...baseInput, startTime: "21:00", endTime: "20:00" })
    ).rejects.toBeInstanceOf(Error);
  });

  it("accepts a :30-aligned create (18:00–19:30)", async () => {
    const created = await service.create(ADMIN_ID, {
      ...baseInput,
      startTime: "18:00",
      endTime: "19:30"
    });
    expect(created.startTime).toBe("18:00");
    expect(created.endTime).toBe("19:30");
  });

  it("rejects a create with a start off the 30-minute grid (:15)", async () => {
    await expect(
      service.create(ADMIN_ID, { ...baseInput, startTime: "18:15", endTime: "19:30" })
    ).rejects.toMatchObject({ status: 400 });
    expect(await service.listActive()).toHaveLength(0);
  });

  it("rejects a create with an end off the 30-minute grid (:45)", async () => {
    await expect(
      service.create(ADMIN_ID, { ...baseInput, startTime: "18:00", endTime: "19:45" })
    ).rejects.toMatchObject({ status: 400 });
    expect(await service.listActive()).toHaveLength(0);
  });

  it("rejects a partial update that moves the start off the 30-minute grid", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    await expect(
      service.update(ADMIN_ID, created.id, { startTime: "18:15" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a partial update that would make endTime <= startTime", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    await expect(service.update(ADMIN_ID, created.id, { endTime: "19:00" })).rejects.toMatchObject({
      status: 400
    });
  });

  it("non-admin create is rejected with ForbiddenException before any write", async () => {
    await expect(service.create(NON_ADMIN_ID, baseInput)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(await service.listActive()).toHaveLength(0);
  });

  it("non-admin update is rejected with ForbiddenException", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    await expect(
      service.update(NON_ADMIN_ID, created.id, { capacity: 4 })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("update of a missing id throws NotFoundException", async () => {
    await expect(
      service.update(ADMIN_ID, "33333333-3333-3333-3333-333333333333", { capacity: 4 })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("deleteGroup (soft-delete cascade)", () => {
    it("sets the group inactive, cascades the future-trainings cancel, and returns the inactive group", async () => {
      const created = await service.create(ADMIN_ID, baseInput);
      trainingsService.cancelCount = 5;

      const result = await service.deleteGroup(ADMIN_ID, created.id);

      expect(result.status).toBe("inactive");
      // Cascade ran for this group with the acting admin.
      expect(trainingsService.cancelledFor).toEqual([
        { actorTelegramId: ADMIN_ID, groupId: created.id }
      ]);
      // The group is gone from the reference-facing active list (immediate disappearance).
      expect(await service.listActive()).toHaveLength(0);
    });

    it("rejects a non-admin with ForbiddenException and never touches the group or trainings", async () => {
      const created = await service.create(ADMIN_ID, baseInput);

      await expect(service.deleteGroup(NON_ADMIN_ID, created.id)).rejects.toBeInstanceOf(
        ForbiddenException
      );
      expect(trainingsService.cancelledFor).toHaveLength(0);
      // No inactivation happened: the group is still active and listed.
      expect(await service.listActive()).toContainEqual(created);
    });

    it("404s a missing group before any inactivation or cascade", async () => {
      await expect(
        service.deleteGroup(ADMIN_ID, "33333333-3333-3333-3333-333333333333")
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(trainingsService.cancelledFor).toHaveLength(0);
    });
  });
});

describe("GroupsService.listMembers (group monthly roster)", () => {
  const CLIENT_TG = 222;
  const GROUP_ID = "00000000-0000-0000-0000-000000000001";
  const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const clientRow = (telegramId: number): Client => ({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Onboarded",
    telegramId,
    telegramUsername: null,
    levelId: null,
    source: "telegram",
    phone: null,
    email: null,
    note: null,
    language: "ru",
    registeredAt: new Date().toISOString(),
    consentGivenAt: null,
    status: "active",
    bonusTrainingCredits: 0
  });

  let repo: FakeGroupsRepository;
  let clientsRepo: FakeClientsRepository;
  let courtsRepo: FakeCourtsRepository;
  let trainingsService: FakeTrainingsService;
  let service: GroupsService;

  beforeEach(async () => {
    repo = new FakeGroupsRepository();
    clientsRepo = new FakeClientsRepository();
    courtsRepo = new FakeCourtsRepository();
    trainingsService = new FakeTrainingsService();
    service = new GroupsService(
      repo as unknown as GroupsRepository,
      clientsRepo as unknown as ClientsRepository,
      courtsRepo as unknown as CourtsRepository,
      trainingsService as unknown as TrainingsService,
      env
    );
    // Seed a group at GROUP_ID so listMembers does not 404.
    await repo.create(baseInput);
    repo.members = [
      { clientId: CLIENT_A, name: "Ана Петровић" },
      { clientId: CLIENT_B, name: "Marko Novak" }
    ];
  });

  it("admin gets full members including clientId and fullName", async () => {
    const result = await service.listMembers(ADMIN_ID, GROUP_ID, 2099, 6);
    expect(result.memberCount).toBe(2);
    const [first] = result.members;
    expect(first.clientId).toBe(CLIENT_A);
    expect(first.fullName).toBe("Ана Петровић");
    expect(first.firstName).toBe("Ана");
    expect(first.avatarInitial).toBe("А");
  });

  it("a client caller gets only firstName + avatarInitial — never clientId/fullName", async () => {
    clientsRepo.client = clientRow(CLIENT_TG);
    const result = await service.listMembers(CLIENT_TG, GROUP_ID, 2099, 6);
    expect(result.memberCount).toBe(2);
    for (const member of result.members) {
      expect(member.clientId).toBeUndefined();
      expect(member.fullName).toBeUndefined();
      expect(member.firstName).toBeTruthy();
      expect(member.avatarInitial).toBeTruthy();
    }
  });

  it("forbids a non-admin caller with no client record (403)", async () => {
    clientsRepo.client = undefined;
    await expect(service.listMembers(999, GROUP_ID, 2099, 6)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("404s a missing group", async () => {
    await expect(
      service.listMembers(ADMIN_ID, "99999999-9999-4999-8999-999999999999", 2099, 6)
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
