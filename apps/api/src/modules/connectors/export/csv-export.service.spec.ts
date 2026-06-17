import { describe, expect, it, vi } from "vitest";
import { buildCsv, csvCell } from "./csv";
import { CsvExportService } from "./csv-export.service";
import type { BookingExportRow, ClientExportRow } from "./export-data.repository";
import { BOOKINGS_HEADER, CLIENTS_HEADER, bookingsTable } from "./export-rows";

describe("csv cell escaping", () => {
  it("leaves a plain value unquoted", () => {
    expect(csvCell("Ivan")).toBe("Ivan");
  });

  it("quotes and escapes commas, quotes, and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("renders null/undefined as an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("renders a number verbatim", () => {
    expect(csvCell(1500)).toBe("1500");
  });
});

describe("buildCsv", () => {
  it("joins a header and escaped rows with CRLF", () => {
    const csv = buildCsv(["a", "b"], [["1", "x,y"]]);
    expect(csv).toBe('a,b\r\n1,"x,y"');
  });
});

const clientRows: ClientExportRow[] = [
  {
    id: "c-1",
    name: "Петров, Иван",
    telegramId: 42,
    telegramUsername: "ivan",
    phone: "+381600000000",
    email: "ivan@example.com",
    source: "telegram",
    status: "active",
    registeredAt: "2026-06-01T10:00:00.000Z"
  }
];

const bookingRows: BookingExportRow[] = [
  {
    id: "b-1",
    clientName: "Иван",
    date: "2026-06-20",
    startTime: "18:00",
    endTime: "19:00",
    type: "single",
    status: "booked",
    paymentStatus: "unpaid",
    priceRsd: 1500,
    createdAt: "2026-06-10T10:00:00.000Z"
  }
];

describe("CsvExportService", () => {
  function makeService(over: {
    clients?: ClientExportRow[];
    bookings?: BookingExportRow[];
  } = {}) {
    const data = {
      findClients: vi.fn(async () => over.clients ?? clientRows),
      findBookings: vi.fn(async () => over.bookings ?? bookingRows)
    };
    return new CsvExportService(data as never);
  }

  it("emits the clients header and an escaped data row", async () => {
    const csv = await makeService().clientsCsv();
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(CLIENTS_HEADER.join(","));
    // The name with a comma is quoted.
    expect(lines[1]).toContain('"Петров, Иван"');
    expect(lines[1]).toContain("ivan@example.com");
  });

  it("emits the bookings header and RSD price as a whole dinar", async () => {
    const csv = await makeService().bookingsCsv();
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(BOOKINGS_HEADER.join(","));
    // Price is a whole-dinar integer with no minor units / formatting.
    expect(lines[1].split(",")).toContain("1500");
  });

  it("renders a price of 0 for a booking with no group price", async () => {
    const table = bookingsTable([{ ...bookingRows[0], priceRsd: 0 }]);
    expect(table.rows[0]).toContain(0);
  });

  it("emits a header-only document when there are no rows", async () => {
    const csv = await makeService({ clients: [] }).clientsCsv();
    expect(csv).toBe(CLIENTS_HEADER.join(","));
  });
});
