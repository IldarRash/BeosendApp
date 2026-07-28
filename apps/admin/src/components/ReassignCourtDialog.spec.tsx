import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_LOCALE, getStaticCatalog, t as resolveTranslation } from "@beosand/i18n";
import type { Court } from "@beosand/types";
import { ToastProvider } from "../ui/Toast";

const useReassignCourtBlock = vi.fn();
vi.mock("../hooks/useCourtBlocks", () => ({
  useReassignCourtBlock: (...args: unknown[]) => useReassignCourtBlock(...args)
}));
vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

import { ReassignCourtDialog } from "./ReassignCourtDialog";

const CATALOG = getStaticCatalog(DEFAULT_LOCALE);
const COURT1: Court = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 1,
  status: "active"
};
const COURT2: Court = {
  id: "22222222-2222-4222-8222-222222222222",
  number: 2,
  status: "active"
};
const COURT3: Court = {
  id: "33333333-3333-4333-8333-333333333333",
  number: 3,
  status: "active"
};

function tr(key: string, params?: Record<string, string | number>): string {
  return resolveTranslation(CATALOG, key, params);
}

function mutation(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
    ...overrides
  };
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof ReassignCourtDialog>> = {}
) {
  const onClose = props.onClose ?? vi.fn();
  const result = render(
    <ToastProvider>
      <ReassignCourtDialog
        blockId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        currentCourtId={COURT1.id}
        courts={[COURT1, COURT2, COURT3]}
        onClose={onClose}
        {...props}
      />
    </ToastProvider>
  );
  return { ...result, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  useReassignCourtBlock.mockReturnValue(mutation());
});

afterEach(cleanup);

describe("ReassignCourtDialog", () => {
  it("disables every dismissal and picker action while reassignment is pending", () => {
    const onClose = vi.fn();
    useReassignCourtBlock.mockReturnValue(mutation({ isPending: true }));
    renderDialog({ onClose });

    const dialog = screen.getByRole("dialog", { name: tr("admin.courtBlocks.changeCourtTitle") });
    expect(within(dialog).getByLabelText(tr("admin.courtBlocks.colCourt"))).toHaveProperty(
      "disabled",
      true
    );
    expect(within(dialog).getByRole("button", { name: tr("admin.action.cancel") })).toHaveProperty(
      "disabled",
      true
    );
    expect(within(dialog).getByRole("button", { name: tr("admin.action.saving") })).toHaveProperty(
      "disabled",
      true
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets mutation state and target selection when the block context changes", () => {
    const reset = vi.fn();
    useReassignCourtBlock.mockReturnValue(mutation({ reset }));
    const { rerender } = renderDialog();
    let select = screen.getByLabelText(tr("admin.courtBlocks.colCourt"));
    expect(select).toHaveProperty("value", COURT2.id);
    fireEvent.change(select, { target: { value: COURT3.id } });
    expect(select).toHaveProperty("value", COURT3.id);

    rerender(
      <ToastProvider>
        <ReassignCourtDialog
          blockId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          currentCourtId={COURT2.id}
          courts={[COURT1, COURT2, COURT3]}
          onClose={vi.fn()}
        />
      </ToastProvider>
    );

    select = screen.getByLabelText(tr("admin.courtBlocks.colCourt"));
    expect(select).toHaveProperty("value", COURT1.id);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("announces the no-alternative and server-error states without submitting", () => {
    const mutate = vi.fn();
    useReassignCourtBlock.mockReturnValue(
      mutation({ mutate, error: new Error("Target court is no longer available") })
    );
    renderDialog({ courts: [COURT1] });

    const dialog = screen.getByRole("dialog", { name: tr("admin.courtBlocks.changeCourtTitle") });
    expect(within(dialog).getByRole("status").textContent).toBe(
      tr("admin.courtBlocks.noAlternativeCourts")
    );
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Target court is no longer available"
    );
    expect(within(dialog).getByRole("button", { name: tr("admin.action.save") })).toHaveProperty(
      "disabled",
      true
    );
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
    expect(mutate).not.toHaveBeenCalled();
  });
});
