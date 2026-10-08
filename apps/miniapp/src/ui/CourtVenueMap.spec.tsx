import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CourtVenueMap, type CourtVenueMapLabels } from "./CourtVenueMap";

const LABELS: CourtVenueMapLabels = {
  title: "Court layout",
  lockers: "Lockers",
  entrance: "Entrance",
  yourCourt: "Your court",
  otherCourts: "Other courts",
  unassigned: "Courts will be shown after confirmation.",
  court: (number) => `Court ${number}`
};

describe("CourtVenueMap", () => {
  it("preserves the venue layout and highlights only caller-provided courts", () => {
    const view = render(<CourtVenueMap courtNumbers={[1, 5]} labels={LABELS} statusLabel="Confirmed" />);

    expect(screen.getByLabelText("Court 1 — Your court")).toBeTruthy();
    expect(screen.getByLabelText("Court 5 — Your court")).toBeTruthy();
    expect(screen.getByLabelText("Court 2 — Other courts")).toBeTruthy();
    expect(view.container.querySelectorAll(".court-venue-map__court.is-selected")).toHaveLength(2);
    expect(view.container.querySelector(".court-venue-map__facility--lockers")).toBeTruthy();
    expect(view.container.querySelector(".court-venue-map__facility--entrance")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });

  it("does not infer assignments when the caller has no court numbers", () => {
    const view = render(<CourtVenueMap courtNumbers={[]} labels={LABELS} />);

    expect(view.container.querySelectorAll(".court-venue-map__court.is-selected")).toHaveLength(0);
    expect(screen.getByText(LABELS.unassigned)).toBeTruthy();
    expect(screen.getByRole("group", { name: new RegExp(LABELS.unassigned) }).getAttribute("aria-label")).toContain(LABELS.unassigned);
  });
});
