import { Module } from "@nestjs/common";
import { CourtRequestsController } from "./court-requests.controller";
import { CourtRequestsRepository } from "./court-requests.repository";
import { CourtRequestsService } from "./court-requests.service";

@Module({
  controllers: [CourtRequestsController],
  providers: [CourtRequestsService, CourtRequestsRepository]
})
export class CourtRequestsModule {}
