import type { InlineKeyboard } from "grammy";
import { describe, expect, it } from "vitest";
import type { CourtAvailability, CourtRequestPreview } from "@beosand/types";
import {
  COURT_ACTIONS,
  courtDateKeyboard,
  courtDateOptions,
  courtDurationKeyboard,
  courtPreviewKeyboard,
  courtPreviewText,
  courtTimeKeyboard,
  formatDayMonth,
  formatRsd,
  parseConfirm,
  parseDate,
  parseDuration,
  parseTime
} from "./court";
import { MENU_ACTIONS } from "./menu";
import { getStaticCatalog } from "@beosand/i18n";

const ru = getStaticCatalog("ru");

function callbacks(kb: InlineKeyboard): (string | undefined)[] {
  return kb.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
}

describe("formatters", () => {
  it("formats a date as DD.MM", () => {
    expect(formatDayMonth("2026-06-15")).toBe("15.06");
  });

  it("space-groups RSD amounts (display only)", () => {
    expect(formatRsd(2000)).toBe("2 000");
    expect(formatRsd(4000)).toBe("4 000");
  });
});

describe("courtDateKeyboard", () => {
  it("offers each date as a namespaced callback and a home path", () => {
    const kb = courtDateKeyboard(ru, ["2026-06-15", "2026-06-16"]);
    expect(callbacks(kb)).toEqual([
      `${COURT_ACTIONS.datePrefix}2026-06-15`,
      `${COURT_ACTIONS.datePrefix}2026-06-16`,
      MENU_ACTIONS.backToMenu
    ]);
  });
});

describe("courtTimeKeyboard", () => {
  const availability: CourtAvailability = {
    date: "2026-06-15",
    slots: [
      { startTime: "14:00", freeCourts: 2 },
      { startTime: "14:30", freeCourts: 0 },
      { startTime: "15:00", freeCourts: 1 }
    ]
  };

  it("renders only bookable 30-min slots (a free court exists), never a full one", () => {
    const cb = callbacks(courtTimeKeyboard(ru, availability));
    expect(cb).toContain(`${COURT_ACTIONS.timePrefix}14:00:2026-06-15`);
    expect(cb).toContain(`${COURT_ACTIONS.timePrefix}15:00:2026-06-15`);
    expect(cb).not.toContain(`${COURT_ACTIONS.timePrefix}14:30:2026-06-15`);
  });

  it("never exposes a court number in any callback or label", () => {
    const kb = courtTimeKeyboard(ru, availability);
    const text = JSON.stringify(kb.inline_keyboard);
    expect(text).not.toMatch(/court[_-]?(id|number)/i);
    const labels = kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels.some((l) => /корт|№/i.test(l))).toBe(false);
  });

  it("offers only the back path when no slot is bookable", () => {
    const none: CourtAvailability = {
      date: "2026-06-15",
      slots: [{ startTime: "15:00", freeCourts: 0 }]
    };
    expect(callbacks(courtTimeKeyboard(ru, none))).toEqual([COURT_ACTIONS.open]);
  });

  it("offers :30 start times from availability.slots", () => {
    const cb = callbacks(courtTimeKeyboard(ru, availability));
    expect(cb).toContain(`${COURT_ACTIONS.timePrefix}14:00:2026-06-15`);
    // a :30-aligned free slot is offerable
    const withHalf: CourtAvailability = {
      date: "2026-06-15",
      slots: [{ startTime: "17:30", freeCourts: 3 }]
    };
    expect(callbacks(courtTimeKeyboard(ru, withHalf))).toContain(
      `${COURT_ACTIONS.timePrefix}17:30:2026-06-15`
    );
  });
});

describe("courtDurationKeyboard", () => {
  it("offers 1h, 1.5h and 2h carrying date + start time as ids", () => {
    const cb = callbacks(courtDurationKeyboard(ru, "2026-06-15", "14:00"));
    expect(cb).toContain(`${COURT_ACTIONS.durationPrefix}1:2026-06-15:14:00`);
    expect(cb).toContain(`${COURT_ACTIONS.durationPrefix}1.5:2026-06-15:14:00`);
    expect(cb).toContain(`${COURT_ACTIONS.durationPrefix}2:2026-06-15:14:00`);
  });
});

describe("courtPreviewText", () => {
  const base: CourtRequestPreview = {
    date: "2026-06-15",
    startTime: "14:00",
    endTime: "16:00",
    durationHours: 2,
    priceRsd: 4000,
    available: true
  };

  it("shows the server price in the required format", () => {
    expect(courtPreviewText(ru, base)).toBe(
      "Дата: 15.06, Время: 14:00–16:00 (2 часа). Итого: 4 000 RSD"
    );
  });

  it("warns and offers no submit when the slot is no longer available", () => {
    const unavailable = { ...base, available: false };
    expect(courtPreviewText(ru, unavailable)).toContain("уже занято");
    const cb = callbacks(courtPreviewKeyboard(ru, unavailable));
    expect(cb.some((c) => c?.startsWith(COURT_ACTIONS.confirmPrefix))).toBe(false);
    expect(cb).toContain(MENU_ACTIONS.backToMenu);
  });

  it("offers a submit button carrying the slot ids when available", () => {
    const cb = callbacks(courtPreviewKeyboard(ru, base));
    expect(cb).toContain(`${COURT_ACTIONS.confirmPrefix}2026-06-15:14:00:2`);
  });

  it("renders a 1.5h preview with the server-computed price (no bot math)", () => {
    const halfHour: CourtRequestPreview = {
      date: "2026-06-15",
      startTime: "17:30",
      endTime: "19:00",
      durationHours: 1.5,
      priceRsd: 3000,
      available: true
    };
    expect(courtPreviewText(ru, halfHour)).toBe(
      "Дата: 15.06, Время: 17:30–19:00 (1.5 часа). Итого: 3 000 RSD"
    );
    expect(callbacks(courtPreviewKeyboard(ru, halfHour))).toContain(
      `${COURT_ACTIONS.confirmPrefix}2026-06-15:17:30:1.5`
    );
  });
});

describe("callback round-trips", () => {
  it("parses a date callback", () => {
    expect(parseDate(`${COURT_ACTIONS.datePrefix}2026-06-15`)).toBe("2026-06-15");
  });

  it("parses a time callback (HH:MM start + trailing date)", () => {
    expect(parseTime(`${COURT_ACTIONS.timePrefix}14:00:2026-06-15`)).toEqual({
      startTime: "14:00",
      date: "2026-06-15"
    });
  });

  it("parses a duration callback", () => {
    expect(parseDuration(`${COURT_ACTIONS.durationPrefix}2:2026-06-15:14:00`)).toEqual({
      durationHours: 2,
      date: "2026-06-15",
      startTime: "14:00"
    });
  });

  it("round-trips a 1.5h duration callback (:30 start)", () => {
    expect(parseDuration(`${COURT_ACTIONS.durationPrefix}1.5:2026-06-15:17:30`)).toEqual({
      durationHours: 1.5,
      date: "2026-06-15",
      startTime: "17:30"
    });
  });

  it("parses a confirm callback", () => {
    expect(parseConfirm(`${COURT_ACTIONS.confirmPrefix}2026-06-15:14:00:2`)).toEqual({
      date: "2026-06-15",
      startTime: "14:00",
      durationHours: 2
    });
  });

  it("round-trips a 1.5h confirm callback (:30 start)", () => {
    expect(parseConfirm(`${COURT_ACTIONS.confirmPrefix}2026-06-15:17:30:1.5`)).toEqual({
      date: "2026-06-15",
      startTime: "17:30",
      durationHours: 1.5
    });
  });
});

describe("callback-data size budget (Telegram caps at 64 bytes)", () => {
  it("keeps the longest court callback under 64 bytes", () => {
    const longest = `${COURT_ACTIONS.confirmPrefix}2026-06-15:17:30:1.5`;
    expect(Buffer.byteLength(longest, "utf8")).toBeLessThanOrEqual(64);
  });
});

describe("courtDateOptions", () => {
  it("returns 7 consecutive ISO dates from today", () => {
    const dates = courtDateOptions(new Date("2026-06-15T10:00:00Z"));
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-06-15");
    expect(dates[6]).toBe("2026-06-21");
  });
});
