import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavProvider, useNav } from "./NavProvider";

function Probe(): JSX.Element {
  const nav = useNav();
  return (
    <>
      <output>{nav.current}</output>
      <button onClick={() => nav.selectTab("calendar")}>Schedule</button>
      <button onClick={() => nav.selectTab("my-bookings")}>Records</button>
      <button onClick={() => nav.selectTab("home")}>Home</button>
      <button onClick={() => nav.push("court")}>Rent</button>
      <button onClick={nav.pop}>Back</button>
      <span>{String(nav.canPop)}</span>
    </>
  );
}

describe("persistent tab navigation", () => {
  it("replaces tab history while nested flows still pop to their parent", () => {
    render(
      <NavProvider>
        <Probe />
      </NavProvider>
    );
    fireEvent.click(screen.getByText("Schedule"));
    fireEvent.click(screen.getByText("Records"));
    fireEvent.click(screen.getByText("Schedule"));
    fireEvent.click(screen.getByText("Rent"));
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByRole("status").textContent).toBe("calendar");
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByRole("status").textContent).toBe("home");
    expect(screen.getByText("false")).toBeDefined();
  });
  it("keeps a direct link reachable and Home resets it", () => {
    render(
      <NavProvider initial="my-bookings">
        <Probe />
      </NavProvider>
    );
    expect(screen.getByRole("status").textContent).toBe("my-bookings");
    fireEvent.click(screen.getByText("Home"));
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByRole("status").textContent).toBe("home");
  });
});
