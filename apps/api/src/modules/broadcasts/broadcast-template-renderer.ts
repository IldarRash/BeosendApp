import {
  BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDERS,
  findUnknownBroadcastTemplatePlaceholders,
  type BroadcastTemplate,
  type SlotCard
} from "@beosand/types";

type TemplateValues = Record<string, string>;

const ALLOWED_PLACEHOLDERS = new Set<string>(BROADCAST_TEMPLATE_ALLOWED_PLACEHOLDERS);

export function renderBroadcastTemplate(template: BroadcastTemplate, slots: SlotCard[]): string {
  if (slots.length === 0) {
    return [renderText(template.bodyTemplate, {}), renderText(template.emptyBodyTemplate, {})]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
  }

  const bodyValues = valuesForSlot(slots[0]);
  const body = renderText(template.bodyTemplate, bodyValues);
  const slotLines = slots
    .map((slot) => renderText(template.slotLineTemplate, valuesForSlot(slot)))
    .join("\n");
  return [body, slotLines].filter((part) => part.trim().length > 0).join("\n\n");
}

function renderText(template: string, values: TemplateValues): string {
  const invalidPlaceholders = findUnknownBroadcastTemplatePlaceholders(template);
  if (invalidPlaceholders.length > 0) {
    throw new Error(
      `Invalid broadcast template placeholder: ${invalidPlaceholders.join(", ")}`
    );
  }

  let output = "";
  for (let index = 0; index < template.length; index += 1) {
    const char = template[index];
    if (char !== "{") {
      output += char;
      continue;
    }

    const closingIndex = template.indexOf("}", index + 1);
    const placeholder = template.slice(index, closingIndex + 1);
    if (!ALLOWED_PLACEHOLDERS.has(placeholder)) {
      throw new Error(`Invalid broadcast template placeholder: ${placeholder}`);
    }

    output += values[placeholder.slice(1, -1)] ?? "";
    index = closingIndex;
  }

  return output;
}

function valuesForSlot(slot: SlotCard): TemplateValues {
  return {
    freeSeats: String(slot.freeSeats),
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    trainer: slot.trainerName,
    level: slot.levelName,
    price: `${slot.priceSingleRsd} RSD`,
    groupName: slot.groupName
  };
}
