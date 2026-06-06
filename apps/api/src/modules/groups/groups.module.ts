import { forwardRef, Module } from "@nestjs/common";
import { ClientsRepository } from "../clients/clients.repository";
import { TrainingsModule } from "../trainings/trainings.module";
import { GroupsController } from "./groups.controller";
import { GroupsRepository } from "./groups.repository";
import { GroupsService } from "./groups.service";

@Module({
  // forwardRef: GroupsService uses TrainingsService (delete cascade) and
  // TrainingsModule already imports GroupsModule (for GroupsRepository).
  imports: [forwardRef(() => TrainingsModule)],
  controllers: [GroupsController],
  providers: [GroupsService, GroupsRepository, ClientsRepository],
  exports: [GroupsRepository]
})
export class GroupsModule {}
