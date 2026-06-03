import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Env } from "@beosand/config";
import type { CreateGroupInput, Group, UpdateGroupInput } from "@beosand/types";
import { beforeEach, describe, expect, it } from "vitest";
import { GroupsService } from "./groups.service";
import type { GroupsRepository } from "./groups.repository";

const ADMIN_ID = 111;
const NON_ADMIN_ID = 999;

const baseInput: CreateGroupInput = {
  name: "Intermediate",
  levelId: "11111111-1111-1111-1111-111111111111",
  daysOfWeek: [1, 3],
  startTime: "20:00",
  endTime: "21:30",
  trainerId: "22222222-2222-2222-2222-222222222222",
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
    const row: Group = { ...input, id, status: "active" };
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
}

const env = { ADMIN_TELEGRAM_IDS: [String(ADMIN_ID)] } as unknown as Env;

describe("GroupsService", () => {
  let repo: FakeGroupsRepository;
  let service: GroupsService;

  beforeEach(() => {
    repo = new FakeGroupsRepository();
    service = new GroupsService(repo as unknown as GroupsRepository, env);
  });

  it("admin create stores the group and it appears in listActive", async () => {
    const created = await service.create(ADMIN_ID, baseInput);
    expect(created.name).toBe("Intermediate");
    expect(created.status).toBe("active");
    expect(await service.listActive()).toContainEqual(created);
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
});
