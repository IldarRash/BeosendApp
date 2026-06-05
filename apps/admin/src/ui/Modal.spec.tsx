import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

import { Modal } from "./Modal";

/**
 * Mirrors the Groups.tsx / Trainers.tsx caller shape that triggered the focus
 * bug: the modal hosts a controlled input whose onChange updates parent state,
 * and `onClose` is an *inline* closure (`() => setOpen(false)`) so its identity
 * changes on every render. The fixed focus-trap effect depends on [open] only
 * and holds onClose behind a ref, so a re-render must not re-run focus.
 */
function FormHost({ onCloseSpy }: { onCloseSpy?: () => void }): JSX.Element {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  return (
    <Modal
      open={open}
      // Fresh closure each render — the regression's trigger.
      onClose={() => {
        onCloseSpy?.();
        setOpen(false);
      }}
      title="Группа"
    >
      <input aria-label="Название" value={value} onChange={(event) => setValue(event.target.value)} />
    </Modal>
  );
}

afterEach(cleanup);

describe("Modal", () => {
  it("renders an accessible dialog labelled by its title when open", () => {
    render(
      <Modal open onClose={() => {}} title="Подтверждение">
        <p>Тело</p>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Labelled by the title element.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Подтверждение");
  });

  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Скрыто">
        <p>Тело</p>
      </Modal>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Закрытие">
        <button type="button">Внутри</button>
      </Modal>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exposes a close control with an accessible name", () => {
    render(
      <Modal open onClose={() => {}} title="Имя">
        <p>Тело</p>
      </Modal>
    );
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeTruthy();
  });
});

describe("Modal focus trap (caret retention)", () => {
  it("moves focus into the dialog when it opens", () => {
    render(<FormHost />);

    const dialog = screen.getByRole("dialog", { name: "Группа" });
    // The effect focuses the first focusable element inside the panel.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps the caret in the input across keystrokes that re-render the parent", () => {
    render(<FormHost />);

    const input = screen.getByLabelText("Название") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // Type character by character. Each keystroke updates parent state and
    // re-renders the modal with a NEW onClose identity. Under the buggy
    // [open, onClose] deps the effect cleanup re-ran and re-focused the first
    // focusable (the × close button), ejecting the caret and dropping all but
    // the first character.
    const typed = "Новички";
    let accumulated = "";
    for (const char of typed) {
      accumulated += char;
      fireEvent.change(input, { target: { value: accumulated } });
      // Caret stays in the field after the re-render, not yanked elsewhere.
      expect(document.activeElement).toBe(input);
    }

    // The full value survived — no characters were lost to a focus reset.
    expect(input.value).toBe(typed);
    // Focus never landed on the dialog's close button.
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).not.toBe("Закрыть");
  });

  it("still closes via Escape after re-renders (onClose held by ref)", () => {
    const onCloseSpy = vi.fn();
    render(<FormHost onCloseSpy={onCloseSpy} />);

    // Force a re-render so onClose identity has churned before Escape.
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "x" } });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
