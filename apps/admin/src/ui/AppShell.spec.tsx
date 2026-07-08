import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NAV_ITEMS } from "../routes";
import { AppShell } from "./AppShell";

vi.mock("@beosand/i18n", () => ({
  LOCALES: ["ru", "sr", "en"],
  localeLabel: { ru: "RU", sr: "SR", en: "EN" }
}));

const labels: Record<string, string> = {
  "admin.brand.sub": "Admin console",
  "admin.lang.label": "Language",
  "admin.nav.sectionsLabel": "Sections",
  "admin.nav.toggle": "Navigation menu",
  "admin.nav.soon": "soon",
  "admin.nav.groupDispatch": "Dispatch",
  "admin.nav.groupSchedule": "Schedule",
  "admin.nav.groupCourts": "Courts",
  "admin.nav.groupClientsMoney": "Clients & Money",
  "admin.nav.groupComms": "Comms",
  "admin.nav.groupSetup": "Setup",
  "admin.nav.overview": "Overview",
  "admin.nav.groups": "Groups",
  "admin.nav.trainings": "Trainings",
  "admin.nav.trainers": "Trainers",
  "admin.nav.managers": "Managers",
  "admin.nav.levels": "Levels",
  "admin.nav.attendance": "Attendance",
  "admin.nav.clients": "Clients",
  "admin.nav.subscriptions": "Subscriptions",
  "admin.nav.courtRequests": "Court requests",
  "admin.nav.courtBlocks": "Court blocks",
  "admin.nav.courtLoad": "Court load",
  "admin.nav.broadcasts": "Broadcasts",
  "admin.nav.analytics": "Analytics",
  "admin.nav.labels": "Labels",
  "admin.nav.notificationTemplates": "Notification templates",
  "admin.nav.connectors": "Connectors",
  "admin.shell.logout": "Log out",
  "admin.shell.statusLabel": "Status",
  "admin.shell.statusText": "API gate",
  "admin.shell.currentSectionLabel": "Current section",
  "admin.shell.workspaceLabel": "Workspace",
  "admin.shell.pendingCourtRequestsBadge": "Court requests: {count}"
};

vi.mock("../i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    locale: "ru",
    setLocale: () => undefined,
    t: (key: string, params?: Record<string, string | number>) =>
      (labels[key] ?? key).replace("{count}", String(params?.count ?? ""))
  })
}));

const logout = vi.fn();
vi.mock("../hooks/useSession", () => ({
  useMe: () => ({ data: { name: "Admin User", username: "admin" } }),
  useLogout: () => logout
}));

let pendingRows: unknown[] = [];
vi.mock("../hooks/useCourtRequests", () => ({
  useCourtRequests: () => ({ data: pendingRows })
}));

function renderShell(path = "/"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <div>Workspace body</div>
      </AppShell>
    </MemoryRouter>
  );
}

beforeEach(() => {
  pendingRows = [{ id: "one" }, { id: "two" }];
  logout.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("AppShell", () => {
  it("keeps every authenticated route reachable after regrouping", () => {
    renderShell("/court-requests");

    const linkPaths = screen
      .getAllByRole("link")
      .map((link) => new URL((link as HTMLAnchorElement).href).pathname);

    expect(linkPaths).toEqual(NAV_ITEMS.map((item) => item.path));
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("closes the mobile drawer on Escape and route change", async () => {
    renderShell("/");

    const toggle = document.querySelector<HTMLButtonElement>("[aria-controls='app-sidebar']");
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle as HTMLButtonElement);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle as HTMLButtonElement);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("link", { name: /Groups/ }));
    await waitFor(() => expect(toggle?.getAttribute("aria-expanded")).toBe("false"));
  });
});
