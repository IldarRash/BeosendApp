import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleDateSheet, formatScheduleDate } from "./ScheduleDateSheet";

const locale = "ru";
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const closePaths: ReadonlyArray<readonly [string, (dialog: HTMLElement) => void]> = [
  [
    "Escape",
    (dialog) => fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }))
  ],
  [
    "backdrop",
    (dialog) => {
      vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
        left: 0,
        right: 100,
        top: 0,
        bottom: 100
      } as DOMRect);
      fireEvent.click(dialog, { clientX: 101, clientY: 101 });
    }
  ],
  [
    "close button",
    () => fireEvent.click(screen.getByRole("button", { name: "miniapp.week.datePickerClose" }))
  ]
];

vi.mock("../i18n/LanguageProvider", () => ({
  useT: () => (key: string) => key,
  useLanguage: () => ({ locale })
}));

function renderSheet(overrides: Partial<ComponentProps<typeof ScheduleDateSheet>> = {}) {
  const onClose = vi.fn();
  const onDate = vi.fn();
  const view = render(
    <ScheduleDateSheet
      open
      date="2026-09-23"
      minimumDate="2026-09-23"
      onClose={onClose}
      onDate={onDate}
      {...overrides}
    />
  );
  return { ...view, onClose, onDate };
}

describe("ScheduleDateSheet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      }
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalShowModal)
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  });

  it("uses a Monday-first grid, disables past days, and crosses a leap-year February", () => {
    renderSheet({ date: "2024-02-29", minimumDate: "2024-02-20" });

    const days = screen.getAllByRole("button");
    expect(
      (screen.getByRole("button", { name: "miniapp.week.datePickerPrevious" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(days.find((button) => button.textContent === "19")?.hasAttribute("disabled")).toBe(true);
    expect(days.find((button) => button.textContent === "29")?.hasAttribute("disabled")).toBe(
      false
    );
    expect(screen.getByRole("button", { name: /26.*феврал/i })).toBeTruthy();
  });

  it("changes only the displayed month until a day is selected", () => {
    const { onDate } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "miniapp.week.datePickerNext" }));

    expect(onDate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^четверг, 1 октября 2026/i })).toBeTruthy();
  });

  it("does not offer today when the schedule lower bound is tomorrow", () => {
    renderSheet({ minimumDate: "2026-09-24" });
    expect(
      (screen.getByRole("button", { name: "miniapp.week.today" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("selects a date, closes, and returns focus to the trigger", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const view = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: /24.*сентябр/i }));

    expect(view.onDate).toHaveBeenCalledWith("2026-09-24");
    expect(view.onClose).toHaveBeenCalledOnce();
    view.rerender(
      <ScheduleDateSheet
        open={false}
        date="2026-09-24"
        minimumDate="2026-09-23"
        onClose={view.onClose}
        onDate={view.onDate}
      />
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("restores the page scroll state when its parent closes or unmounts the sheet", () => {
    document.body.style.overflow = "scroll";
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const view = renderSheet();
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(
      <ScheduleDateSheet
        open={false}
        date="2026-09-23"
        minimumDate="2026-09-23"
        onClose={view.onClose}
        onDate={view.onDate}
      />
    );
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(trigger);

    view.unmount();
    expect(document.body.style.overflow).toBe("scroll");
    trigger.remove();
  });

  it.each(closePaths)("closes from %s", (_source, close) => {
    const { onClose } = renderSheet();
    close(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("formats dates with Russian genitive months and Serbian Latin", () => {
    expect(formatScheduleDate("2026-09-23", "ru")).toMatch(/23.*сентябр/i);
    expect(formatScheduleDate("2026-09-23", "sr")).toMatch(/23.*septembar/i);
  });
});
