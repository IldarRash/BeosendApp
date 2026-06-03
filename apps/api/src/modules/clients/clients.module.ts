import { Module } from "@nestjs/common";
import { LevelsRepository } from "../levels/levels.repository";
import { ClientsController } from "./clients.controller";
import { ClientsRepository } from "./clients.repository";
import { ClientsService } from "./clients.service";

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientsRepository, LevelsRepository]
})
export class ClientsModule {}
