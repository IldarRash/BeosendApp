import { Module } from "@nestjs/common";
import { ConnectorsModule } from "../connectors/connectors.module";
import { CourtRequestsController } from "./court-requests.controller";
import { CourtRequestsRepository } from "./court-requests.repository";
import { CourtRequestsService } from "./court-requests.service";

/**
 * Court-request moderation (Edition 2). Post-commit client notifications now go
 * through the connectors ChannelDispatcher (replacing the removed in-module
 * CourtNotifier) and emit typed domain events via DomainEventsService, so Slices A–C
 * can consume court decisions. Imports ConnectorsModule for both.
 */
@Module({
  imports: [ConnectorsModule],
  controllers: [CourtRequestsController],
  providers: [CourtRequestsService, CourtRequestsRepository]
})
export class CourtRequestsModule {}
