import {
  broadcastAutomationActivity,
  broadcastAutomationAudienceSchema,
  broadcastAutomationMessageSchema,
  broadcastAutomationTriggerSchema,
  type BroadcastAutomationAudience,
  type CreateBroadcastAutomationInput
} from "@beosand/types";
import { uuid } from "@beosand/types";
import { z } from "zod";

/** The only JSONB shape written by the automation module. */
const automationConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    trigger: broadcastAutomationTriggerSchema,
    audience: broadcastAutomationAudienceSchema,
    message: broadcastAutomationMessageSchema
  })
  .strict();

const legacyAudienceSchema = z
  .object({
    levelIds: z.array(uuid).min(1).max(100),
    activity: broadcastAutomationActivity
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.levelIds).size !== value.levelIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["levelIds"], message: "levelIds must be unique" });
    }
  });

const legacyAutomationConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    trigger: broadcastAutomationTriggerSchema,
    audience: legacyAudienceSchema,
    message: broadcastAutomationMessageSchema
  })
  .strict();

export type AutomationConfig = Pick<
  CreateBroadcastAutomationInput,
  "name" | "trigger" | "audience" | "message"
>;

const dimensionOrder = { level: 0, activity: 1, gender: 2 } as const;

/**
 * Reads persisted config fail-closed. New documents are parsed first; only a
 * wholly valid former level/activity document may use the legacy bridge.
 */
export function normalizeAutomationConfig(value: unknown): AutomationConfig {
  const current = automationConfigSchema.safeParse(value);
  if (current.success) {
    return canonicalize(current.data);
  }

  const legacy = legacyAutomationConfigSchema.safeParse(value);
  if (!legacy.success) {
    throw new Error("Malformed broadcast automation configuration");
  }

  return canonicalize({
    ...legacy.data,
    audience: {
      filters: [
        { dimension: "level", levelIds: legacy.data.audience.levelIds },
        { dimension: "activity", value: legacy.data.audience.activity }
      ]
    }
  });
}

function canonicalize(config: AutomationConfig): AutomationConfig {
  const audience: BroadcastAutomationAudience = {
    filters: [...config.audience.filters]
      .map((filter) =>
        filter.dimension === "level"
          ? { ...filter, levelIds: [...filter.levelIds].sort() }
          : filter
      )
      .sort((left, right) => dimensionOrder[left.dimension] - dimensionOrder[right.dimension])
  };
  return { ...config, audience };
}
