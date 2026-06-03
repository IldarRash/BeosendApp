import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationsService } from "./notifications.service";
import { NotificationsScheduler } from "./notifications.scheduler";

describe("NotificationsScheduler", () => {
  let sendDueReminders: ReturnType<typeof vi.fn>;
  let scheduler: NotificationsScheduler;

  beforeEach(() => {
    sendDueReminders = vi.fn().mockResolvedValue(0);
    const service = { sendDueReminders } as unknown as NotificationsService;
    scheduler = new NotificationsScheduler(service);
  });

  it("drives both the 24h and 3h reminders on each scan with a single clock", async () => {
    await scheduler.scanReminders();

    expect(sendDueReminders).toHaveBeenCalledTimes(2);
    const types = sendDueReminders.mock.calls.map((call) => call[0]);
    expect(types).toContain("reminder-24h");
    expect(types).toContain("reminder-3h");

    // Both scans share one `now` so the windows are computed off the same tick.
    const [, now24] = sendDueReminders.mock.calls[0];
    const [, now3] = sendDueReminders.mock.calls[1];
    expect(now24).toBeInstanceOf(Date);
    expect((now24 as Date).getTime()).toBe((now3 as Date).getTime());
  });

  it("does not throw and still drives reminders when a window yields nothing", async () => {
    sendDueReminders.mockResolvedValue(0);
    await expect(scheduler.scanReminders()).resolves.toBeUndefined();
    expect(sendDueReminders).toHaveBeenCalledTimes(2);
  });

  it("completes a scan that actually sent reminders", async () => {
    sendDueReminders.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    await expect(scheduler.scanReminders()).resolves.toBeUndefined();
  });
});
