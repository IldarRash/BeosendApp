import { Module } from "@nestjs/common";
import { CourtsController } from "./courts.controller";
import { CourtsRepository } from "./courts.repository";
import { CourtsService } from "./courts.service";

@Module({
  controllers: [CourtsController],
  providers: [CourtsService, CourtsRepository]
})
export class CourtsModule {}
