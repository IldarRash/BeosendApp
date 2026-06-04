import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DayOfWeek } from "@beosand/types";

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

import { DayOfWeekPicker } from "./DayOfWeekPicker";

afterEach(cleanup);

describe("DayOfWeekPicker", () => {
  it("renders seven toggles in an accessible labelled group", () => {
    render(<DayOfWeekPicker label="Дни недели" value={[]} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Дни недели" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(7);
    // Full RU day names are the accessible labels (1=Пн … 7=Вс).
    expect(screen.getByRole("button", { name: "Понедельник" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Воскресенье" })).toBeTruthy();
  });

  it("reflects the selected days via aria-pressed", () => {
    render(
      <DayOfWeekPicker label="Дни" value={[1, 3] as DayOfWeek[]} onChange={() => {}} />
    );
    expect(screen.getByRole("button", { name: "Понедельник" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: "Среда" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Вторник" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
  });

  it("adds a day on click, returning ISO dayOfWeek values in order", () => {
    const onChange = vi.fn();
    render(
      <DayOfWeekPicker label="Дни" value={[3] as DayOfWeek[]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Понедельник" }));
    // Selection is sorted into ISO order regardless of click order.
    expect(onChange).toHaveBeenCalledWith([1, 3]);
  });

  it("removes an already-selected day on click", () => {
    const onChange = vi.fn();
    render(
      <DayOfWeekPicker label="Дни" value={[1, 5] as DayOfWeek[]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Понедельник" }));
    expect(onChange).toHaveBeenCalledWith([5]);
  });

  it("shows a validation error wired to the group via aria-describedby", () => {
    render(
      <DayOfWeekPicker label="Дни" value={[]} onChange={() => {}} error="Выберите хотя бы один день" />
    );
    const group = screen.getByRole("group", { name: "Дни" });
    const describedBy = group.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      "Выберите хотя бы один день"
    );
  });
});
