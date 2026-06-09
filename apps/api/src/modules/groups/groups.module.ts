import { forwardRef, Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { CourtsRepository } from "../courts/courts.repository";
import { TrainingsModule } from "../trainings/trainings.module";
import { GroupsController } from "./groups.controller";
import { GroupsRepository } from "./groups.repository";
import { GroupsService } from "./groups.service";

@Module({
  // forwardRef: GroupsService uses TrainingsService (delete cascade) and
  // TrainingsModule already imports GroupsModule (for GroupsRepository).
  imports: [forwardRef(() => TrainingsModule)],
  controllers: [GroupsController],
  // CourtsRepository (only deps DatabaseService) is provided directly to validate
  // a group's home court is active, mirroring how ClientsRepository is provided.
  providers: [GroupsService, GroupsRepository, ClientsRepository, CourtsRepository],
  exports: [GroupsRepository]
})
export class GroupsModule {}
