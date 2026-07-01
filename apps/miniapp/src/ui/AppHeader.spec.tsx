import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Client } from "@beosand/types";
import { LanguageProvider } from "../i18n/LanguageProvider";
import type { TgUser } from "../tg/TgSdkProvider";
import { AppHeader } from "./AppHeader";

const CLIENT: Pick<Client, "name" | "telegramPhotoUrl"> = {
  name: "Аня",
  telegramPhotoUrl: "https://t.me/i/userpic/320/client.jpg"
};

let sdkUser: TgUser | null;
const apiClient = {
  getMe: vi.fn(() => ({ telegramId: 42, name: "Аня", language: "ru" }))
};

vi.mock("../api/ApiProvider", () => ({
  useApi: () => ({ client: apiClient, status: "ready", error: null })
}));

vi.mock("../tg/TgSdkProvider", () => ({
  useTg: () => ({
    isTelegram: true,
    initDataRaw: "init-data",
    startParam: null,
    user: sdkUser
  })
}));

function renderHeader(client: Pick<Client, "name" | "telegramPhotoUrl"> | null = CLIENT): void {
  render(
    <LanguageProvider>
      <AppHeader client={client} onProfile={vi.fn()} />
    </LanguageProvider>
  );
}

beforeEach(() => {
  sdkUser = {
    firstName: "SDK",
    lastName: null,
    username: "sdk",
    photoUrl: "https://t.me/i/userpic/320/sdk.jpg"
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppHeader avatar", () => {
  it("renders the durable client photo instead of the SDK photo when a client record exists", () => {
    renderHeader();

    const img = screen.getByRole("img", { name: "Аня" });
    expect(img.getAttribute("src")).toBe(CLIENT.telegramPhotoUrl);
  });

  it("uses the SDK photo only while no client record is available", () => {
    renderHeader(null);

    const img = screen.getByRole("img", { name: "SDK" });
    expect(img.getAttribute("src")).toBe("https://t.me/i/userpic/320/sdk.jpg");
  });

  it("falls back to the client-name initial when the client has no stored photo", () => {
    renderHeader({ ...CLIENT, telegramPhotoUrl: null });

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByLabelText("Профиль").textContent).toContain("А");
  });
});
