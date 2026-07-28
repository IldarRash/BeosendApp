/* eslint-disable @typescript-eslint/no-explicit-any -- Zod default inference is optional at this boundary. */
import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { z, type ZodSchema } from "zod";
import { createBroadcastAutomationSchema, updateBroadcastAutomationSchema, enableBroadcastAutomationSchema, disableBroadcastAutomationSchema, previewBroadcastAutomationSchema, listBroadcastAutomationsQuerySchema, listBroadcastAutomationRunsQuerySchema, retryBroadcastAutomationFailuresSchema } from "@beosand/types";
import { BroadcastAutomationsService } from "./broadcast-automations.service";

@Controller("broadcast-automations")
export class BroadcastAutomationsController {
  constructor(private readonly service: BroadcastAutomationsService) {}
  @Get() list(@Headers("x-telegram-id") h: string | undefined, @Query() q: unknown) { return this.service.list(actor(h), valid(listBroadcastAutomationsQuerySchema, q ?? {}) as any); }
  @Post() create(@Headers("x-telegram-id") h: string | undefined, @Body() b: unknown) { return this.service.create(actor(h), valid(createBroadcastAutomationSchema, b ?? {})); }
  @Get(":id") get(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string) { return this.service.get(actor(h), valid(z.string().uuid(), id)); }
  @Patch(":id") update(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Body() b: unknown) { return this.service.update(actor(h), valid(z.string().uuid(), id), valid(updateBroadcastAutomationSchema, b ?? {})); }
  @Post(":id/enable") enable(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Body() b: unknown) { return this.service.enable(actor(h), valid(z.string().uuid(), id), valid(enableBroadcastAutomationSchema, b ?? {})); }
  @Post(":id/disable") disable(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Body() b: unknown) { return this.service.disable(actor(h), valid(z.string().uuid(), id), valid(disableBroadcastAutomationSchema, b ?? {})); }
  @Post(":id/preview") preview(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Body() b: unknown) { return this.service.preview(actor(h), valid(z.string().uuid(), id), valid(previewBroadcastAutomationSchema, b ?? {})); }
}
@Controller("broadcast-automation-runs")
export class BroadcastAutomationRunsController {
  constructor(private readonly service: BroadcastAutomationsService) {}
  @Get() list(@Headers("x-telegram-id") h: string | undefined, @Query() q: unknown) { return this.service.listRuns(actor(h), valid(listBroadcastAutomationRunsQuerySchema, q ?? {}) as any); }
  @Get(":id") get(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string) { return this.service.runDetail(actor(h), valid(z.string().uuid(), id)); }
  @Post(":id/retry-failures") retry(@Headers("x-telegram-id") h: string | undefined, @Param("id") id: string, @Body() b: unknown) { return this.service.retry(actor(h), valid(z.string().uuid(), id), valid(retryBroadcastAutomationFailuresSchema, b ?? {}) as any); }
}
function actor(header: string | undefined): number { const value = Number(header); if (!header || !Number.isInteger(value)) throw new BadRequestException("Missing or invalid x-telegram-id header"); return value; }
function valid<T>(schema: ZodSchema<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(x => x.message).join("; ")); return parsed.data; }
