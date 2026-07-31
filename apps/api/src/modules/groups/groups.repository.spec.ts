import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "@beosand/db";
import { describe, expect, it } from "vitest";
import { GroupsRepository } from "./groups.repository";
import type { DatabaseService } from "../../db/database.service";

describe("GroupsRepository.listFutureBookableTrainingDates WHERE filter", () => {
  async function renderWhere(): Promise<string> {
    let where: unknown;
    const builder = {
      from: () => builder,
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      orderBy: async () => [] as { date: string }[]
    };
    const db = { select: () => builder } as unknown as Database;
    const repo = new GroupsRepository({ db } as unknown as DatabaseService);

    await repo.listFutureBookableTrainingDates(
      "11111111-1111-4111-8111-111111111111",
      "2026-06-15",
      "2026-07-31"
    );

    expect(where).toBeDefined();
    return new PgDialect().sqlToQuery(where as never).sql.toLowerCase();
  }

  it("scopes to one group, date range, and non-terminal training statuses", async () => {
    const sql = await renderWhere();

    expect(sql).toContain('"group_id" =');
    expect(sql).toContain('"status" in');
    expect(sql).toContain('"date" >=');
    expect(sql).toContain('"date" <=');
    expect(sql).toContain('"trainings"."hidden" =');
  });
});

describe("GroupsRepository.listMonthMembers visibility", () => {
  async function renderWhere(includeHiddenTrainings: boolean): Promise<string> {
    let where: unknown;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      orderBy: async () => []
    };
    const db = { selectDistinct: () => builder } as unknown as Database;
    const repo = new GroupsRepository({ db } as unknown as DatabaseService);

    await repo.listMonthMembers(
      "11111111-1111-4111-8111-111111111111",
      "2026-06-01",
      "2026-06-30",
      includeHiddenTrainings
    );

    return new PgDialect().sqlToQuery(where as never).sql.toLowerCase();
  }

  it("excludes hidden training rosters from the client projection", async () => {
    expect(await renderWhere(false)).toContain('"trainings"."hidden" =');
  });

  it("keeps hidden training rosters available to admins for internal accounting", async () => {
    expect(await renderWhere(true)).not.toContain('"trainings"."hidden" =');
  });
});

describe("GroupsRepository.findClientBookableById WHERE filter", () => {
  async function renderWhere(): Promise<string> {
    let where: unknown;
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: (predicate: unknown) => {
        where = predicate;
        return builder;
      },
      limit: async () => []
    };
    const db = { select: () => builder } as unknown as Database;
    const repo = new GroupsRepository({ db } as unknown as DatabaseService);

    await repo.findClientBookableById("11111111-1111-4111-8111-111111111111");

    expect(where).toBeDefined();
    return new PgDialect().sqlToQuery(where as never).sql.toLowerCase();
  }

  it("matches the client-bookable group predicate", async () => {
    const sql = await renderWhere();

    expect(sql).toContain('"groups"."id" =');
    expect(sql).toContain('"groups"."status" =');
    expect(sql).toContain('"groups"."hidden" =');
    expect(sql).toContain('"trainers"."status" =');
    expect(sql).toContain('"levels"."status" =');
  });
});
