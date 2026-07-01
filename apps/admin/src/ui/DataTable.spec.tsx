import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyTableControls, DataTable, hasActiveTableControls, type Column } from "./DataTable";

interface Row {
  id: string;
  name: string | null;
  status: "active" | "inactive";
  count: number | null;
  date: string | null;
}

const rows: Row[] = [
  { id: "a", name: "Beta", status: "active", count: 2, date: "2026-07-02" },
  { id: "b", name: "Alpha", status: "inactive", count: 10, date: "2026-07-01" },
  { id: "c", name: "Alpha", status: "active", count: 1, date: null },
  { id: "d", name: null, status: "active", count: null, date: "2026-07-03" }
];

const columns: Column<Row>[] = [
  {
    key: "name",
    header: "Имя",
    render: (row) => row.name ?? "—",
    sortValue: (row) => row.name,
    filter: { kind: "text", value: (row) => row.name }
  },
  {
    key: "status",
    header: "Статус",
    render: (row) => row.status,
    sortValue: (row) => row.status,
    filter: {
      kind: "select",
      value: (row) => row.status,
      options: [
        { value: "active", label: "Активен" },
        { value: "inactive", label: "Неактивен" }
      ]
    }
  },
  {
    key: "count",
    header: "Счет",
    render: (row) => row.count ?? "—",
    sortValue: (row) => row.count,
    filter: { kind: "number", value: (row) => row.count }
  },
  {
    key: "date",
    header: "Дата",
    render: (row) => row.date ?? "—",
    sortValue: (row) => row.date,
    filter: { kind: "date", value: (row) => row.date }
  }
];

afterEach(cleanup);

describe("DataTable controls", () => {
  it("applies stable sort, keeps nulls last, and clears back to source order", () => {
    expect(
      applyTableControls(rows, columns, {
        sort: { key: "name", direction: "asc" },
        filters: {}
      }).map((row) => row.id)
    ).toEqual(["b", "c", "a", "d"]);

    expect(
      applyTableControls(rows, columns, {
        sort: { key: "count", direction: "desc" },
        filters: {}
      }).map((row) => row.id)
    ).toEqual(["b", "a", "c", "d"]);

    expect(applyTableControls(rows, columns, { sort: null, filters: {} }).map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
      "d"
    ]);
  });

  it("combines text, exact select, numeric, and date filters with AND semantics", () => {
    const filtered = applyTableControls(rows, columns, {
      sort: { key: "date", direction: "asc" },
      filters: {
        name: "a",
        status: "active",
        count: { min: "1", max: "2" },
        date: { from: "2026-07-01", to: "2026-07-02" }
      }
    });

    expect(filtered.map((row) => row.id)).toEqual(["a"]);
  });

  it("tracks active controls from sort and filter values", () => {
    expect(hasActiveTableControls({ sort: null, filters: {} })).toBe(false);
    expect(hasActiveTableControls({ sort: { key: "name", direction: "asc" }, filters: {} })).toBe(true);
    expect(hasActiveTableControls({ sort: null, filters: { name: "beta" } })).toBe(true);
    expect(hasActiveTableControls({ sort: null, filters: { count: { min: "", max: "" } } })).toBe(false);
  });

  it("renders accessible sort/filter controls and reset restores the loaded row order", () => {
    render(
      <DataTable
        caption="Тестовая таблица"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
      />
    );

    const table = screen.getByRole("table");
    const headerRow = within(table).getAllByRole("row")[0];
    fireEvent.click(within(headerRow).getByRole("button", { name: /Имя/ }));
    expect(within(headerRow).getByRole("columnheader", { name: /Имя/ }).getAttribute("aria-sort")).toBe(
      "ascending"
    );

    fireEvent.change(screen.getByLabelText("Фильтр: Статус"), { target: { value: "inactive" } });
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    const bodyRows = within(table).getAllByRole("row").slice(2);
    expect(bodyRows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "Beta",
      "Alpha",
      "Alpha",
      "—"
    ]);
  });
});
