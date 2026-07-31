import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { BroadcastAutomationsService } from "./broadcast-automations.service";
@Injectable()
export class BroadcastAutomationsScheduler { constructor(private readonly service: BroadcastAutomationsService) {} @Cron(CronExpression.EVERY_MINUTE) async sweep(): Promise<void> { await this.service.sweep(); } }
