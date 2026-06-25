import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { GroupMember } from "@beosand/types";
import { ParticipantsRow } from "./ParticipantsRow";

/**
 * The shared "кто записан" roster row, reused by the group-month preview and the
 * single-training confirm step. Purely presentational: it renders the API's
 * client-narrowed members (first name + initial) and the server count, or a calm
 * empty state. No counting or identity math here.
 */

const MEMBERS: ReadonlyArray<GroupMember> = [
  { firstName: "Аня", avatarInitial: "А" },
  { firstName: "Марко", avatarInitial: "М" }
];

function renderRow(members: ReadonlyArray<GroupMember>, count: number) {
  return render(
    <AppRoot>
      <ParticipantsRow
        members={members}
        count={count}
        title="Кто записан"
        emptyLabel="Пока никто не записан"
      />
    </AppRoot>
  );
}

afterEach(cleanup);

describe("ParticipantsRow", () => {
  it("renders the title with the count and each member's name + initial", () => {
    renderRow(MEMBERS, 2);

    // The heading shows the server-supplied count, never re-derived from the list.
    expect(screen.getByText("Кто записан · 2")).toBeTruthy();

    // Each member chip carries the first name and the avatar initial.
    expect(screen.getByText("Аня")).toBeTruthy();
    expect(screen.getByText("Марко")).toBeTruthy();
    expect(screen.getByText("А")).toBeTruthy();
    expect(screen.getByText("М")).toBeTruthy();

    // The section is labelled by its title for assistive tech.
    expect(screen.getByRole("region", { name: "Кто записан" })).toBeTruthy();
  });

  it("renders the calm empty state (and no chips) when no one signed up", () => {
    renderRow([], 0);

    expect(screen.getByText("Кто записан · 0")).toBeTruthy();
    expect(screen.getByText("Пока никто не записан")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
