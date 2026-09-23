import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { RecordStatusService } from "./record-status.service";

@Injectable()
export class RecordStatusScheduler {
  constructor(private readonly records: RecordStatusService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  dispatch(): Promise<void> {
    return this.records.dispatchPending();
  }
}
