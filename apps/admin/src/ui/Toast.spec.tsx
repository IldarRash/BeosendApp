import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

vi.mock("../i18n/LanguageProvider", () => ({
  useT: () => (key: string) => {
    if (key === "admin.action.close") return "Close";
    if (key === "admin.notify.label") return "Notifications";
    return key;
  }
}));

function TriggerToast(): JSX.Element {
  const { notify } = useToast();
  return (
    <button type="button" onClick={() => notify("Saved", "success")}>
      Show toast
    </button>
  );
}

afterEach(cleanup);

describe("ToastProvider", () => {
  it("announces persistent toasts and lets the operator dismiss them", () => {
    render(
      <ToastProvider>
        <TriggerToast />
      </ToastProvider>
    );

    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    expect(screen.getByText("Saved")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Saved")).toBeNull();
  });
});
