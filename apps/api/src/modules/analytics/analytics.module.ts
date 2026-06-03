import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsRepository } from "./analytics.repository";
import { AnalyticsService } from "./analytics.service";

/**
 * Analytics & reports (T3.1): admin-only, read-only aggregations over the
 * authoritative tables (ТЗ §17). No writes, no schedulers, no outbound sends —
 * so it imports nothing beyond the global Db/Config modules already in scope.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRepository]
})
export class AnalyticsModule {}
