import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { OptionList, type Option } from "./OptionList";

const OPTIONS: ReadonlyArray<Option<string>> = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" }
];

function renderList(selected: string, onSelect = vi.fn()) {
  return render(
    <AppRoot>
      <OptionList name="lang" options={OPTIONS} selected={selected} onSelect={onSelect} />
    </AppRoot>
  );
}

describe("OptionList", () => {
  it("marks exactly the selected option (radio + aria-current), not by color alone", () => {
    renderList("en");

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    const checked = radios.filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].getAttribute("aria-label")).toBe("English");
  });

  it("groups its radios under the given name (so two lists don't share one group)", () => {
    renderList("en");

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.every((r) => r.name === "lang")).toBe(true);
  });

  it("invokes onSelect exactly once with the option value when a row is chosen", () => {
    const onSelect = vi.fn();
    renderList("ru", onSelect);

    // Selection is driven by the row (label) click; the Radio is presentational, so
    // a single tap fires onSelect once — never twice via a second Radio onChange.
    const enRadio = screen.getByLabelText("English");
    enRadio.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("en");
  });
});
