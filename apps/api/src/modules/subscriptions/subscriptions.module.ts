import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsRepository } from "./subscriptions.repository";
import { SubscriptionsService } from "./subscriptions.service";

/**
 * Subscription payment tracking (admin console only): admin-gated read of monthly
 * subscriptions and a single transactional mark-paid/unpaid over all their
 * non-cancelled bookings. priceMonthRsd → totalRsd comes from the groups join in
 * the aggregate query; the global Db/Config modules are already in scope.
 */
@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsRepository]
})
export class SubscriptionsModule {}
