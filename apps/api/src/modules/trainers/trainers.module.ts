import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TrainersController } from "./trainers.controller";
import { TrainersRepository } from "./trainers.repository";
import { TrainersService } from "./trainers.service";

@Module({
  imports: [NotificationsModule, ClientsModule],
  controllers: [TrainersController],
  providers: [TrainersService, TrainersRepository],
  exports: [TrainersRepository]
})
export class TrainersModule {}
