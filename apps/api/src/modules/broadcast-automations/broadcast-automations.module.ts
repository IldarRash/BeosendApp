import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { BroadcastAutomationsController, BroadcastAutomationRunsController } from "./broadcast-automations.controller";
import { BroadcastAutomationsRepository } from "./broadcast-automations.repository";
import { BroadcastAutomationsScheduler } from "./broadcast-automations.scheduler";
import { BroadcastAutomationsService } from "./broadcast-automations.service";

@Module({
  imports: [NotificationsModule],
  controllers: [BroadcastAutomationsController, BroadcastAutomationRunsController],
  providers: [BroadcastAutomationsRepository, BroadcastAutomationsService, BroadcastAutomationsScheduler],
  exports: [BroadcastAutomationsService]
})
export class BroadcastAutomationsModule {}
