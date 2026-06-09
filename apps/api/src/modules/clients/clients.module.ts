import { Module } from "@nestjs/common";
import { LevelsRepository } from "../levels/levels.repository";
import { ManagersModule } from "../managers/managers.module";
import { ClientsController } from "./clients.controller";
import { ClientsRepository } from "./clients.repository";
import { ClientsService } from "./clients.service";

@Module({
  // ManagersModule exports StaffLinkingService — bot onboarding links a
  // trainer/manager added by @username on first contact.
  imports: [ManagersModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientsRepository, LevelsRepository],
  exports: [ClientsRepository]
})
export class ClientsModule {}
