import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { GroupMember } from "@beosand/types";
import { ParticipantsRow } from "./ParticipantsRow";

const TITLE = "\u041a\u0442\u043e \u0437\u0430\u043f\u0438\u0441\u0430\u043d";
const EMPTY = "\u041f\u043e\u043a\u0430 \u043d\u0438\u043a\u0442\u043e \u043d\u0435 \u0437\u0430\u043f\u0438\u0441\u0430\u043d";
const ANYA = "\u0410\u043d\u044f";
const ANYA_INITIAL = "\u0410";
const MARKO = "\u041c\u0430\u0440\u043a\u043e";
const MARKO_INITIAL = "\u041c";

const MEMBERS: ReadonlyArray<GroupMember> = [
  { firstName: ANYA, avatarInitial: ANYA_INITIAL, telegramPhotoUrl: null },
  { firstName: MARKO, avatarInitial: MARKO_INITIAL, telegramPhotoUrl: null }
];

const MEMBERS_WITH_PHOTO: ReadonlyArray<GroupMember> = [
  {
    firstName: "Anya",
    avatarInitial: "A",
    telegramPhotoUrl: "https://t.me/i/userpic/320/anya.jpg"
  }
];

function renderRow(members: ReadonlyArray<GroupMember>, count: number) {
  return render(
    <AppRoot>
      <ParticipantsRow
        members={members}
        count={count}
        title={TITLE}
        emptyLabel={EMPTY}
      />
    </AppRoot>
  );
}

afterEach(cleanup);

describe("ParticipantsRow", () => {
  it("renders the title with the count and each member's name + initial", () => {
    renderRow(MEMBERS, 2);

    expect(screen.getByText(`${TITLE} \u00b7 2`)).toBeTruthy();
    expect(screen.getByText(ANYA)).toBeTruthy();
    expect(screen.getByText(MARKO)).toBeTruthy();
    expect(screen.getByText(ANYA_INITIAL)).toBeTruthy();
    expect(screen.getByText(MARKO_INITIAL)).toBeTruthy();
    expect(screen.getByRole("region", { name: TITLE })).toBeTruthy();
  });

  it("renders the calm empty state (and no chips) when no one signed up", () => {
    renderRow([], 0);

    expect(screen.getByText(`${TITLE} \u00b7 0`)).toBeTruthy();
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders a Telegram photo when telegramPhotoUrl is present", () => {
    const view = renderRow(MEMBERS_WITH_PHOTO, 1);

    const img = view.container.querySelector<HTMLImageElement>(".roster__avatar-img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://t.me/i/userpic/320/anya.jpg");
    expect(screen.getByText("Anya")).toBeTruthy();
  });

  it("falls back to the avatar initial when the photo is missing or broken", () => {
    const missingPhoto: ReadonlyArray<GroupMember> = [
      { firstName: "Lena", avatarInitial: "L", telegramPhotoUrl: null }
    ];
    const missing = renderRow(missingPhoto, 1);

    expect(missing.container.querySelector(".roster__avatar-img")).toBeNull();
    expect(screen.getByText("L")).toBeTruthy();
    cleanup();

    const broken = renderRow(MEMBERS_WITH_PHOTO, 1);
    const img = broken.container.querySelector<HTMLImageElement>(".roster__avatar-img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(broken.container.querySelector(".roster__avatar-img")).toBeNull();
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("Anya")).toBeTruthy();
  });
});
