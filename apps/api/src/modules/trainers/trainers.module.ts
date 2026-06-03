import { Module } from "@nestjs/common";
import { TrainersController } from "./trainers.controller";
import { TrainersRepository } from "./trainers.repository";
import { TrainersService } from "./trainers.service";

@Module({
  controllers: [TrainersController],
  providers: [TrainersService, TrainersRepository],
  exports: [TrainersRepository]
})
export class TrainersModule {}
