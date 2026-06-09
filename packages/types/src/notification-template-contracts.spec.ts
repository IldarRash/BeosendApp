import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
  notificationTemplateKey,
  notificationTemplateSchema,
  updateNotificationTemplateSchema
} from "./notification-template-contracts";

describe("notification template contracts", () => {
  it("enumerates exactly the 7 editable event keys", () => {
    expect(notificationTemplateKey.options).toEqual([
      "booking-confirmed",
      "reminder-24h",
      "reminder-3h",
      "training-cancelled",
      "booking-pending",
      "booking-declined",
      "waitlist-slot"
    ]);
  });

  it("offers a placeholder list for every key, with windowMinutes only on waitlist-slot", () => {
    for (const key of notificationTemplateKey.options) {
      const placeholders = NOTIFICATION_TEMPLATE_PLACEHOLDERS[key];
      expect(placeholders).toContain("{training}");
      expect(placeholders).toContain("{trainerName}");
      const hasWindow = placeholders.includes("{windowMinutes}");
      expect(hasWindow).toBe(key === "waitlist-slot");
    }
  });

  it("accepts a valid template entry", () => {
    expect(
      notificationTemplateSchema.parse({
        eventKey: "booking-confirmed",
        body: "Запись подтверждена ✅\n{training}",
        isOverridden: false,
        defaultBody: "Запись подтверждена ✅\n{training}",
        placeholders: ["{training}"]
      })
    ).toBeDefined();
  });

  it("rejects an empty or whitespace-only update body", () => {
    expect(updateNotificationTemplateSchema.safeParse({ body: "" }).success).toBe(false);
    expect(updateNotificationTemplateSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("trims and accepts a non-empty update body", () => {
    const parsed = updateNotificationTemplateSchema.parse({ body: "  привет  " });
    expect(parsed.body).toBe("привет");
  });

  it("rejects unknown fields on the update body", () => {
    expect(
      updateNotificationTemplateSchema.safeParse({ body: "ok", eventKey: "x" }).success
    ).toBe(false);
  });
});
