import { z } from "zod";
import { entityStatus, uuid } from "./common";

/**
 * Mirrors training-contracts broadcastType and @beosand/db broadcast_type.
 * Kept local so broadcast-template contracts do not import the large training
 * contract module.
 */
export const broadcastTemplateBroadcastType = z.enum(["today", "tomorrow", "week", "freed-up"]);
export type BroadcastTemplateBroadcastType = z.infer<typeof broadcastTemplateBroadcastType>;

export const broadcastTemplateVariableKey = z.enum([
  "freeSeats",
  "date",
  "startTime",
  "endTime",
  "trainer",
  "level",
  "price",
  "groupName"
]);
export type BroadcastTemplateVariableKey = z.infer<typeof broadcastTemplateVariableKey>;

export const broadcastTemplateVariableValueType = z.enum(["string", "integer", "rsd"]);
export type BroadcastTemplateVariableValueType = z.infer<
  typeof broadcastTemplateVariableValueType
>;

export const broadcastTemplateVariableSchema = z
  .object({
    key: broadcastTemplateVariableKey,
    placeholder: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    example: z.string().min(1),
    valueType: broadcastTemplateVariableValueType
  })
  .strict()
  .superRefine((value, ctx) => {
    const expectedPlaceholder = `{${value.key}}`;
    if (value.placeholder !== expectedPlaceholder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `placeholder must be ${expectedPlaceholder}`,
        path: ["placeholder"]
      });
    }
  });
export type BroadcastTemplateVariable = z.infer<typeof broadcastTemplateVariableSchema>;

export const BROADCAST_TEMPLATE_VARIABLES = [
  {
    key: "freeSeats",
    placeholder: "{freeSeats}",
    label: "Free seats",
    description: "Server-computed remaining capacity for the slot.",
    example: "5",
    valueType: "integer"
  },
  {
    key: "date",
    placeholder: "{date}",
    label: "Date",
    description: "Training calendar date.",
    example: "2026-07-08",
    valueType: "string"
  },
  {
    key: "startTime",
    placeholder: "{startTime}",
    label: "Start time",
    description: "Training start time.",
    example: "18:00",
    valueType: "string"
  },
  {
    key: "endTime",
    placeholder: "{endTime}",
    label: "End time",
    description: "Training end time.",
    example: "19:30",
    valueType: "string"
  },
  {
    key: "trainer",
    placeholder: "{trainer}",
    label: "Trainer",
    description: "Trainer display name resolved by the server.",
    example: "Ana",
    valueType: "string"
  },
  {
    key: "level",
    placeholder: "{level}",
    label: "Level",
    description: "Level display name resolved by the server.",
    example: "Beginner",
    valueType: "string"
  },
  {
    key: "price",
    placeholder: "{price}",
    label: "Price",
    description: "Server-owned single-training price display.",
    example: "1500 RSD",
    valueType: "rsd"
  },
  {
    key: "groupName",
    placeholder: "{groupName}",
    label: "Group name",
    description: "Full group name resolved from the training group.",
    example: "Beach Start",
    valueType: "string"
  }
] as const satisfies readonly BroadcastTemplateVariable[];

export const BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDERS = BROADCAST_TEMPLATE_VARIABLES.map(
  (variable) => variable.placeholder
);

const BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDER_SET = new Set<string>(
  BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDERS
);

export function extractBroadcastTemplatePlaceholders(template: string): string[] {
  return scanBroadcastTemplatePlaceholders(template).placeholders;
}

export function findUnknownBroadcastTemplatePlaceholders(template: string): string[] {
  return scanBroadcastTemplatePlaceholders(template).invalidPlaceholders;
}

function scanBroadcastTemplatePlaceholders(template: string): {
  placeholders: string[];
  invalidPlaceholders: string[];
} {
  const placeholders: string[] = [];
  const invalidPlaceholders: string[] = [];

  for (let index = 0; index < template.length; index += 1) {
    const char = template[index];
    if (char === "{") {
      const closingIndex = template.indexOf("}", index + 1);
      if (closingIndex === -1) {
        invalidPlaceholders.push(template.slice(index));
        break;
      }

      const placeholder = template.slice(index, closingIndex + 1);
      if (BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDER_SET.has(placeholder)) {
        placeholders.push(placeholder);
      } else {
        invalidPlaceholders.push(placeholder);
      }
      index = closingIndex;
      continue;
    }

    if (char === "}") {
      invalidPlaceholders.push("}");
    }
  }

  return {
    placeholders: Array.from(new Set(placeholders)),
    invalidPlaceholders: Array.from(new Set(invalidPlaceholders))
  };
}

const broadcastTemplateTextSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    const unknownPlaceholders = findUnknownBroadcastTemplatePlaceholders(value);
    for (const placeholder of unknownPlaceholders) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown broadcast template placeholder: ${placeholder}`
      });
    }
  });
const broadcastTemplateNameSchema = z.string().trim().min(1);

export const broadcastTemplateSchema = z
  .object({
    id: uuid,
    name: broadcastTemplateNameSchema,
    broadcastType: broadcastTemplateBroadcastType,
    status: entityStatus,
    bodyTemplate: broadcastTemplateTextSchema,
    slotLineTemplate: broadcastTemplateTextSchema,
    emptyBodyTemplate: broadcastTemplateTextSchema,
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    updatedBy: z.number().int().nullable()
  })
  .strict();
export type BroadcastTemplate = z.infer<typeof broadcastTemplateSchema>;

export const createBroadcastTemplateSchema = z
  .object({
    name: broadcastTemplateNameSchema,
    broadcastType: broadcastTemplateBroadcastType,
    bodyTemplate: broadcastTemplateTextSchema,
    slotLineTemplate: broadcastTemplateTextSchema,
    emptyBodyTemplate: broadcastTemplateTextSchema
  })
  .strict();
export type CreateBroadcastTemplateInput = z.infer<typeof createBroadcastTemplateSchema>;

export const updateBroadcastTemplateSchema = z
  .object({
    name: broadcastTemplateNameSchema.optional(),
    status: entityStatus.optional(),
    bodyTemplate: broadcastTemplateTextSchema.optional(),
    slotLineTemplate: broadcastTemplateTextSchema.optional(),
    emptyBodyTemplate: broadcastTemplateTextSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one template field is required"
  });
export type UpdateBroadcastTemplateInput = z.infer<typeof updateBroadcastTemplateSchema>;
