import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ManagersModule } from "../managers/managers.module";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionBridgeMiddleware } from "./session-bridge.middleware";

/**
 * Admin web-console auth seam (admin-console brief, M0/M1). Exports AuthService
 * and AdminAuthGuard so other admin modules can adopt the guard as they migrate
 * off the raw x-telegram-id header. Registers SessionBridgeMiddleware globally
 * (M1) so a verified web session is bridged into the existing x-telegram-id
 * convention without touching any controller.
 */
@Module({
  imports: [ManagersModule],
  controllers: [AuthController],
  providers: [AuthService, AdminAuthGuard],
  exports: [AuthService, AdminAuthGuard]
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionBridgeMiddleware).forRoutes("*");
  }
}
