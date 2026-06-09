import { Module } from "@nestjs/common";
import { TrainersRepository } from "../trainers/trainers.repository";
import { AdminRegistryService } from "./admin-registry.service";
import { ManagersController } from "./managers.controller";
import { ManagersRepository } from "./managers.repository";
import { ManagersService } from "./managers.service";
import { StaffLinkingService } from "./staff-linking.service";

/**
 * DB-backed managers (admins) + the synchronous admin registry + staff username
 * linking. Exports AdminRegistryService and StaffLinkingService so the auth /
 * clients modules can link staff on first contact. TrainersRepository (only deps
 * DatabaseService) is provided directly to link trainers by username, mirroring
 * how GroupsModule provides ClientsRepository/CourtsRepository.
 */
@Module({
  controllers: [ManagersController],
  providers: [
    ManagersService,
    ManagersRepository,
    AdminRegistryService,
    StaffLinkingService,
    TrainersRepository
  ],
  exports: [AdminRegistryService, StaffLinkingService]
})
export class ManagersModule {}
