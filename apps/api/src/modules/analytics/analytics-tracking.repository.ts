import { Injectable } from "@nestjs/common";
import { schema } from "@beosand/db";
import { DatabaseService } from "../../db/database.service";

export interface NewAnalyticsSession {
  entryPoint: "direct" | "training" | "court" | "other";
  source: string;
  campaign: string | null;
}

/** Isolated write seam for privacy-minimised acquisition sessions. */
@Injectable()
export class AnalyticsTrackingRepository {
  constructor(private readonly database: DatabaseService) {}

  async createSession(input: NewAnalyticsSession): Promise<string> {
    const [created] = await this.database.db
      .insert(schema.analyticsSessions)
      .values(input)
      .returning({ id: schema.analyticsSessions.id });
    return created.id;
  }
}
