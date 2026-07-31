import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { createMonthlySchedulePlanSchema, createMonthlyScheduleTemplateSchema, listMonthlyScheduleNotificationDeliveriesQuerySchema, monthlySchedulePlanQuerySchema, updateMonthlyScheduleTemplateSchema, uuid, type MonthlyScheduleActionResult, type MonthlyScheduleNotificationDelivery, type MonthlySchedulePlanView } from "@beosand/types";
import type { ZodSchema } from "zod";
import { MonthlyScheduleService } from "./monthly-schedule.service";

@Controller("monthly-schedule-plans")
export class MonthlyScheduleController {
  constructor(private readonly schedules: MonthlyScheduleService) {}
  @Get() get(@Headers("x-telegram-id") h: string | undefined, @Query() q: unknown): Promise<MonthlySchedulePlanView | null> { return this.schedules.get(actor(h), parse(monthlySchedulePlanQuerySchema, q ?? {})); }
  @Post() create(@Headers("x-telegram-id") h: string | undefined, @Body() b: unknown): Promise<MonthlySchedulePlanView> { return this.schedules.createOrGet(actor(h), parse(createMonthlySchedulePlanSchema, b ?? {})); }
  @Get(":id/notification-deliveries") deliveries(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Query() q: unknown): Promise<MonthlyScheduleNotificationDelivery[]> { const query = parse(listMonthlyScheduleNotificationDeliveriesQuerySchema, q ?? {}); return this.schedules.listNotificationDeliveries(actor(h), parse(uuid, id), query.outcome); }
  @Post(":id/templates") add(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Body() b: unknown): Promise<MonthlySchedulePlanView> { return this.schedules.addTemplate(actor(h), parse(uuid, id), parse(createMonthlyScheduleTemplateSchema, b ?? {})); }
  @Patch(":id/templates/:templateId") update(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Param("templateId") tid: string, @Body() b: unknown): Promise<MonthlyScheduleActionResult> { return this.schedules.updateTemplate(actor(h), parse(uuid, id), parse(uuid, tid), parse(updateMonthlyScheduleTemplateSchema, b ?? {})); }
  @Delete(":id/templates/:templateId") remove(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Param("templateId") tid: string): Promise<MonthlySchedulePlanView> { return this.schedules.deleteTemplate(actor(h), parse(uuid, id), parse(uuid, tid)); }
  @Post(":id/approve") approve(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string): Promise<MonthlyScheduleActionResult> { return this.schedules.approve(actor(h), parse(uuid, id)); }
  @Post(":id/generate") generate(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string): Promise<MonthlyScheduleActionResult> { return this.schedules.generate(actor(h), parse(uuid, id)); }
  @Post(":id/publish") publish(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string): Promise<MonthlyScheduleActionResult> { return this.schedules.publish(actor(h), parse(uuid, id)); }
}
function actor(header: string | undefined): number { const id = Number(header); if (!header || !Number.isInteger(id)) throw new BadRequestException("Missing or invalid x-telegram-id header"); return id; }
function parse<T>(schema: ZodSchema<T>, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new BadRequestException(result.error.issues.map((i) => i.message).join("; ")); return result.data; }
