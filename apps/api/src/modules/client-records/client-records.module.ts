import { Module } from "@nestjs/common";
import { ClientRecordsController } from "./client-records.controller";
import { ClientRecordsRepository } from "./client-records.repository";
import { ClientRecordsService } from "./client-records.service";
@Module({ controllers: [ClientRecordsController], providers: [ClientRecordsRepository, ClientRecordsService] })
export class ClientRecordsModule {}
