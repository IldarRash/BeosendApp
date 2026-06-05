import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Client, Court, Group, Trainer, Training } from "@beosand/types";

// Hooks are mocked so the page can be unit-tested without the ApiClient/network.
const useTrainings = vi.fn();
const useGenerateMonth = vi.fn();
const useGenerateAllGroups = vi.fn();
const useCancelTraining = vi.fn();
const useChangeCapacity = vi.fn();
const useGroups = vi.fn();
const useTrainers = vi.fn();
const useCourts = vi.fn();
const useClientsList = vi.fn();
const useCreateWalkIn = vi.fn();
const useBookManual = vi.fn();

vi.mock("../hooks/useTrainings", () => ({
  useTrainings: (...args: unknown[]) => useTrainings(...args),
  useGenerateMonth: () => useGenerateMonth(),
  useGenerateAllGroups: () => useGenerateAllGroups(),
  useCancelTraining: () => useCancelTraining(),
  useChangeCapacity: () => useChangeCapacity()
}));
vi.mock("../hooks/useClients", () => ({
  useClientsList: (...args: unknown[]) => useClientsList(...args),
  useCreateWalkIn: () => useCreateWalkIn(),
  useBookManual: () => useBookManual()
}));
vi.mock("../hooks/useGroups", () => ({ useGroups: () => useGroups() }));
vi.mock("../hooks/useTrainers", () => ({ useTrainers: () => useTrainers() }));
vi.mock("../hooks/useCourts", () => ({ useCourts: () => useCourts() }));

// AppShell pulls in the router/nav; stub it to a passthrough for an isolated page test.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const notify = vi.fn();
vi.mock("../ui/Toast", () => ({ useToast: () => ({ notify }) }));

import { Trainings } from "./Trainings";

const GROUP: Group = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Утренняя группа",
  levelId: "22222222-2222-2222-2222-222222222222",
  daysOfWeek: [1, 3],
  startTime: "08:00",
  endTime: "09:30",
  trainerId: "33333333-3333-3333-3333-333333333333",
  trainerName: "Марко",
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 9000,
  status: "active"
};

const TRAINER: Trainer = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Анна",
  type: "main",
  status: "active",
  telegramId: null
};

const COURTS: Court[] = [
  { id: "c1111111-1111-1111-1111-111111111111", number: 1, status: "active" },
  { id: "c2222222-2222-2222-2222-222222222222", number: 2, status: "active" }
];

const TRAINING: Training = {
  id: "44444444-4444-4444-4444-444444444444",
  groupId: GROUP.id,
  date: "2026-07-06",
  startTime: "08:00",
  endTime: "09:30",
  trainerId: TRAINER.id,
  capacity: 12,
  bookedCount: 4,
  status: "open"
};

const CLIENT: Client = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Марко",
  telegramId: null,
  telegramUsername: null,
  levelId: null,
  source: "walk_in",
  phone: "+381601234567",
  note: null,
  registeredAt: "2026-01-01T00:00:00.000Z",
  status: "active",
  language: "ru"
};

/** A passive (no-op) mutation result the page can call .reset()/.mutate() on. */
function idleMutation(): Record<string, unknown> {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null };
}

/** A settled query result shape the page reads (isFetching/isError/data). */
function idleQuery(data: unknown): Record<string, unknown> {
  return { isFetching: false, isError: false, error: null, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  useGroups.mockReturnValue({ data: [GROUP] });
  useTrainers.mockReturnValue({ data: [TRAINER] });
  useCourts.mockReturnValue({ data: COURTS });
  useGenerateMonth.mockReturnValue(idleMutation());
  useGenerateAllGroups.mockReturnValue(idleMutation());
  useCancelTraining.mockReturnValue(idleMutation());
  useChangeCapacity.mockReturnValue(idleMutation());
  useClientsList.mockReturnValue(idleQuery([CLIENT]));
  useCreateWalkIn.mockReturnValue(idleMutation());
  useBookManual.mockReturnValue(idleMutation());
  useTrainings.mockReturnValue({ isPending: false, isError: false, error: null, data: [TRAINING] });
});

afterEach(cleanup);

/** Set a from/to range so `useTrainings` is queried (the page gates on it). */
function setRange(): void {
  fireEvent.change(screen.getByLabelText("С даты"), { target: { value: "2026-07-01" } });
  fireEvent.change(screen.getByLabelText("По дату"), { target: { value: "2026-07-31" } });
}

describe("Trainings page", () => {
  it("renders the API's rows with booked/capacity and status as returned (no recompute)", () => {
    render(<Trainings />);
    setRange();

    const table = screen.getByRole("table");
    const row = within(table).getByText("2026-07-06").closest("tr") as HTMLElement;
    expect(within(row).getByText("08:00–09:30")).toBeTruthy();
    expect(within(row).getByText("Утренняя группа")).toBeTruthy();
    expect(within(row).getByText("Анна")).toBeTruthy();
    // Occupancy and status are shown exactly as the contract delivers them.
    expect(within(row).getByText("4 / 12")).toBeTruthy();
    expect(within(row).getByText("Открыта")).toBeTruthy();
  });

  it("prompts before cancelling and only calls the mutation on confirm", () => {
    const mutate = vi.fn();
    useCancelTraining.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    // The confirm dialog is shown; the mutation has not fired yet.
    const dialog = screen.getByRole("dialog", { name: "Отменить тренировку" });
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Отменить тренировку" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe(TRAINING.id);
  });

  it("generates a month with the chosen preferred court", () => {
    const mutate = vi.fn();
    useGenerateMonth.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);

    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать месяц" }));
    const dialog = screen.getByRole("dialog", { name: "Сгенерировать месяц" });
    fireEvent.change(within(dialog).getByLabelText("Группа"), { target: { value: GROUP.id } });
    fireEvent.change(within(dialog).getByLabelText("Год"), { target: { value: "2026" } });
    fireEvent.change(within(dialog).getByLabelText("Месяц"), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText("Корт для блокировок"), {
      target: { value: COURTS[1].id }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сгенерировать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      groupId: GROUP.id,
      year: 2026,
      month: 7,
      courtId: COURTS[1].id
    });
  });

  it("omits courtId from the generate payload when auto-pick is left selected", () => {
    const mutate = vi.fn();
    useGenerateMonth.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);

    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать месяц" }));
    const dialog = screen.getByRole("dialog", { name: "Сгенерировать месяц" });
    fireEvent.change(within(dialog).getByLabelText("Группа"), { target: { value: GROUP.id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сгенерировать" }));

    expect(mutate.mock.calls[0][0]).not.toHaveProperty("courtId");
  });

  it("runs generate-all and shows the server's per-group summary", () => {
    const mutate = vi.fn((_, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({
        perGroup: [
          { groupId: GROUP.id, groupName: "Утренняя группа", created: 8, blocked: 7, skipped: 1 }
        ]
      })
    );
    useGenerateAllGroups.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);

    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать все группы" }));
    const allDialog = screen.getByRole("dialog", { name: "Сгенерировать все группы" });
    fireEvent.click(within(allDialog).getByRole("button", { name: "Сгенерировать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    // The per-group summary modal renders the API's created/blocked/skipped counts.
    const resultDialog = screen.getByRole("dialog", { name: "Итоги генерации по группам" });
    const row = within(resultDialog).getByText("Утренняя группа").closest("tr") as HTMLElement;
    expect(within(row).getByText("8")).toBeTruthy();
    expect(within(row).getByText("7")).toBeTruthy();
    // skipped > 0 is flagged with a warn note.
    expect(within(resultDialog).getByRole("alert")).toBeTruthy();
  });

  it("surfaces the server's rejection when capacity is set below booked count", () => {
    useChangeCapacity.mockReturnValue({
      ...idleMutation(),
      isError: true,
      error: new Error("Вместимость не может быть ниже числа записанных (4).")
    });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Вместимость" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить вместимость" });
    // The server-decided error is rendered; the page never computes the floor itself.
    expect(
      within(dialog).getByText("Вместимость не может быть ниже числа записанных (4).")
    ).toBeTruthy();
  });

  it("books an existing client picked from the server-searched list", () => {
    const mutate = vi.fn();
    useBookManual.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Добавить человека" }));
    const dialog = screen.getByRole("dialog", { name: "Добавить человека на тренировку" });
    // Pick the client returned by the (mocked) search and submit.
    fireEvent.change(within(dialog).getByLabelText("Выберите клиента"), {
      target: { value: CLIENT.id }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Записать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ clientId: CLIENT.id, trainingId: TRAINING.id });
  });

  it("creates a walk-in then books the returned client", () => {
    const createMutate = vi.fn((_input, opts: { onSuccess: (c: Client) => void }) =>
      opts.onSuccess(CLIENT)
    );
    const bookMutate = vi.fn();
    useCreateWalkIn.mockReturnValue({ ...idleMutation(), mutate: createMutate });
    useBookManual.mockReturnValue({ ...idleMutation(), mutate: bookMutate });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Добавить человека" }));
    const dialog = screen.getByRole("dialog", { name: "Добавить человека на тренировку" });
    // Switch to the walk-in (no-Telegram) mode and fill the name + phone.
    fireEvent.change(within(dialog).getByLabelText("Добавить человека на тренировку"), {
      target: { value: "new" }
    });
    fireEvent.change(within(dialog).getByLabelText("Имя"), { target: { value: "Марко" } });
    fireEvent.change(within(dialog).getByLabelText("Телефон (необязательно)"), {
      target: { value: "+381601234567" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Записать" }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toEqual({ name: "Марко", phone: "+381601234567" });
    // The walk-in is created, then the returned client is booked onto the training.
    expect(bookMutate).toHaveBeenCalledTimes(1);
    expect(bookMutate.mock.calls[0][0]).toEqual({ clientId: CLIENT.id, trainingId: TRAINING.id });
  });

  it("renders the server's 409 message when a manual booking is rejected", () => {
    useBookManual.mockReturnValue({
      ...idleMutation(),
      isError: true,
      error: new Error("Тренировка заполнена.")
    });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Добавить человека" }));
    const dialog = screen.getByRole("dialog", { name: "Добавить человека на тренировку" });
    // The server's decision is rendered verbatim; the console computes no capacity.
    expect(within(dialog).getByText("Тренировка заполнена.")).toBeTruthy();
  });

  it("disables Add person on a full training (server is still authoritative)", () => {
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [{ ...TRAINING, status: "full", bookedCount: 12 }]
    });
    render(<Trainings />);
    setRange();
    expect(screen.getByRole("button", { name: "Добавить человека" }).hasAttribute("disabled")).toBe(
      true
    );
  });
});
