import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

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
