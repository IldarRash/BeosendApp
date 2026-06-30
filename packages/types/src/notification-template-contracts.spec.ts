import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TEMPLATE_AUDIENCE,
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
  notificationTemplateKey,
  notificationTemplateSchema,
  updateNotificationTemplateSchema
} from "./notification-template-contracts";

describe("notification template contracts", () => {
  it("enumerates exactly the editable event keys", () => {
    expect(notificationTemplateKey.options).toEqual([
      "booking-confirmed",
      "reminder-24h",
      "reminder-3h",
      "training-cancelled",
      "booking-pending",
      "booking-declined",
      "waitlist-promoted",
      "waitlist-displaced",
      "court-request-confirmed",
      "court-request-rejected",
      "booking-pending-admin",
      "individual-request-admin",
      "court-request-created-admin"
    ]);
  });

  it("offers a non-empty placeholder list for every key, with {position} only on waitlist-displaced", () => {
    for (const key of notificationTemplateKey.options) {
      const placeholders = NOTIFICATION_TEMPLATE_PLACEHOLDERS[key];
      expect(placeholders.length).toBeGreaterThan(0);
      const hasPosition = placeholders.includes("{position}");
      expect(hasPosition).toBe(key === "waitlist-displaced");
    }
  });

  it("offers selected slot placeholders for individual request staff DMs", () => {
    expect(NOTIFICATION_TEMPLATE_PLACEHOLDERS["individual-request-admin"]).toEqual([
      "{clientName}",
      "{trainerName}",
      "{date}",
      "{startTime}",
      "{endTime}"
    ]);
  });

  it("classifies every key as client or staff, with the *-admin keys as staff", () => {
    for (const key of notificationTemplateKey.options) {
      const audience = NOTIFICATION_TEMPLATE_AUDIENCE[key];
      expect(["client", "staff"]).toContain(audience);
      expect(audience).toBe(key.endsWith("-admin") ? "staff" : "client");
    }
  });

  it("accepts a valid template entry", () => {
    expect(
      notificationTemplateSchema.parse({
        eventKey: "booking-confirmed",
        audience: "client",
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
