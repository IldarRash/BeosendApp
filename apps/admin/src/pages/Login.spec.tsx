import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TelegramLoginPayload } from "@beosand/types";

// --- Mocks ---------------------------------------------------------------

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({ useToast: () => ({ notify }) }));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

// useLogin resolves immediately by invoking the caller's onSuccess, so the
// post-login redirect logic runs without a real Telegram exchange.
const loginMutate = vi.fn(
  (_payload: TelegramLoginPayload, opts: { onSuccess: () => void }) => opts.onSuccess()
);
vi.mock("../hooks/useSession", () => ({
  useLogin: () => ({ mutate: loginMutate, isPending: false })
}));

import { Login } from "./Login";

const ONAUTH = "onTelegramAuth";
const validPayload: TelegramLoginPayload = {
  id: 111,
  first_name: "Admin",
  auth_date: 1_700_000_000,
  hash: "deadbeef"
};

function fireWidgetAuth(): void {
  const onauth = (window as unknown as Record<string, (u: unknown) => void>)[ONAUTH];
  act(() => onauth(validPayload));
}

function renderAt(state?: { from?: string }): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/login", state }]}>
      <Login />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigate.mockReset();
  notify.mockReset();
  loginMutate.mockClear();
});
afterEach(() => cleanup());

describe("Login post-auth redirect", () => {
  it("returns to the deep-link page captured in location state (state.from)", () => {
    renderAt({ from: "/trainings" });
    fireWidgetAuth();
    expect(navigate).toHaveBeenCalledWith("/trainings", { replace: true });
  });

  it("falls back to the dashboard when there is no state.from (direct visit)", () => {
    renderAt();
    fireWidgetAuth();
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
  });
});
