import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  Client,
  Court,
  Group,
  Trainer,
  Training,
  TrainingCalendarItem,
  TrainingRoster
} from "@beosand/types";

// Hooks are mocked so the page can be unit-tested without the ApiClient/network.
const useTrainings = vi.fn();
const useGenerateMonth = vi.fn();
const useGenerateAllGroups = vi.fn();
const useGenerateIndividualMonth = vi.fn();
const useRescheduleTraining = vi.fn();
const useUpdateIndividualPrice = vi.fn();
const useDeleteTraining = vi.fn();
const useDeleteTrainingSeries = vi.fn();
const useChangeCapacity = vi.fn();
const useUpdateTrainingSchedule = vi.fn();
const useGroups = vi.fn();
const useGenerationStatus = vi.fn();
const useTrainers = vi.fn();
const useCourts = vi.fn();
const useClientsList = vi.fn();
const useCreateWalkIn = vi.fn();
const useBookManual = vi.fn();
const useTrainingDetail = vi.fn();
const useRoster = vi.fn();
const useTrainingsCalendar = vi.fn();

vi.mock("../hooks/useTrainings", () => ({
  useTrainings: (...args: unknown[]) => useTrainings(...args),
  useGenerateMonth: () => useGenerateMonth(),
  useGenerateAllGroups: () => useGenerateAllGroups(),
  useGenerateIndividualMonth: () => useGenerateIndividualMonth(),
  useRescheduleTraining: () => useRescheduleTraining(),
  useUpdateIndividualPrice: () => useUpdateIndividualPrice(),
  useDeleteTraining: () => useDeleteTraining(),
  useDeleteTrainingSeries: () => useDeleteTrainingSeries(),
  useChangeCapacity: () => useChangeCapacity(),
  useUpdateTrainingSchedule: () => useUpdateTrainingSchedule()
}));
vi.mock("../hooks/useClients", () => ({
  useClientsList: (...args: unknown[]) => useClientsList(...args),
  useCreateWalkIn: () => useCreateWalkIn(),
  useBookManual: () => useBookManual()
}));
vi.mock("../hooks/useGroups", () => ({ useGroups: () => useGroups() }));
vi.mock("../hooks/useGenerationStatus", () => ({
  useGenerationStatus: (...args: unknown[]) => useGenerationStatus(...args)
}));
vi.mock("../hooks/useTrainers", () => ({ useTrainers: () => useTrainers() }));
vi.mock("../hooks/useCourts", () => ({ useCourts: () => useCourts() }));
vi.mock("../hooks/useTrainingDetail", () => ({
  useTrainingDetail: (...args: unknown[]) => useTrainingDetail(...args)
}));
vi.mock("../hooks/useTrainingsCalendar", () => ({
  useTrainingsCalendar: (...args: unknown[]) => useTrainingsCalendar(...args)
}));
vi.mock("../hooks/useRoster", () => ({
  useRoster: (...args: unknown[]) => useRoster(...args),
  useCancelRosterParticipant: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null
  })
}));
// The roster modal now renders the under-roster waitlist section; mock its hooks
// so opening the modal doesn't reach the real ApiClient.
const useTrainingWaitlist = vi.fn();
vi.mock("../hooks/useWaitlist", () => ({
  useTrainingWaitlist: (...args: unknown[]) => useTrainingWaitlist(...args),
  usePromoteWaitlistEntry: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
  useRemoveWaitlistEntry: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
  useSwapWaitlistEntry: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null })
}));

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
  courtId: null,
  courtNumber: null,
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 9000,
  hidden: false,
  status: "active"
};

const TRAINER: Trainer = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Анна",
  type: "main",
  status: "active",
  telegramId: null,
  telegramUsername: null,
  language: "sr",
  individualVisible: true
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
  priceSingleRsd: 1500,
  clientId: null,
  status: "open"
};

/** An individual (1-on-1) training: group-less, with an owning client + price. */
const INDIVIDUAL: Training = {
  id: "99999999-9999-4999-8999-999999999999",
  groupId: null,
  date: "2026-07-07",
  startTime: "18:00",
  endTime: "19:00",
  trainerId: TRAINER.id,
  capacity: 1,
  bookedCount: 1,
  priceSingleRsd: 2500,
  clientId: "55555555-5555-5555-5555-555555555555",
  status: "open"
};

const CLIENT: Client = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Марко",
  telegramId: null,
  telegramUsername: null,
  telegramPhotoUrl: null,
  levelId: null,
  source: "walk_in",
  phone: "+381601234567",
  email: null,
  note: null,
  registeredAt: "2026-01-01T00:00:00.000Z",
  consentGivenAt: null,
  status: "active",
  language: "ru",
  bonusTrainingCredits: 0
};

const DETAIL: TrainingCalendarItem = {
  id: TRAINING.id,
  groupId: GROUP.id,
  date: "2026-07-06",
  startTime: "08:00",
  endTime: "09:30",
  trainerId: TRAINER.id,
  capacity: 12,
  bookedCount: 4,
  priceSingleRsd: 1500,
  clientId: null,
  status: "open",
  groupName: "Утренняя группа",
  trainerName: "Анна",
  courtId: COURTS[0].id,
  courtNumber: 3
};

const ROSTER: TrainingRoster = {
  trainingId: TRAINING.id,
  date: "2026-07-06",
  startTime: "08:00",
  endTime: "09:30",
  levelName: "Начинающие",
  participants: [
    {
      bookingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      clientId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      clientName: "Игорь",
      telegramPhotoUrl: null,
      bookingStatus: "booked",
      bookingType: "single",
      groupSubscriptionId: null
    },
    {
      bookingId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      clientId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      clientName: "Мария",
      telegramPhotoUrl: null,
      bookingStatus: "booked",
      bookingType: "group",
      groupSubscriptionId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    }
  ]
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
  useGenerationStatus.mockReturnValue(idleQuery([]));
  useTrainers.mockReturnValue({ data: [TRAINER] });
  useCourts.mockReturnValue({ data: COURTS });
  useGenerateMonth.mockReturnValue(idleMutation());
  useGenerateAllGroups.mockReturnValue(idleMutation());
  useGenerateIndividualMonth.mockReturnValue(idleMutation());
  useRescheduleTraining.mockReturnValue(idleMutation());
  useUpdateIndividualPrice.mockReturnValue(idleMutation());
  useDeleteTraining.mockReturnValue(idleMutation());
  useDeleteTrainingSeries.mockReturnValue(idleMutation());
  useChangeCapacity.mockReturnValue(idleMutation());
  useUpdateTrainingSchedule.mockReturnValue(idleMutation());
  useClientsList.mockReturnValue(idleQuery([CLIENT]));
  useCreateWalkIn.mockReturnValue(idleMutation());
  useBookManual.mockReturnValue(idleMutation());
  useTrainings.mockReturnValue({ isPending: false, isError: false, error: null, data: [TRAINING] });
  useTrainingsCalendar.mockReturnValue(idleQuery([DETAIL]));
  // Roster modal: detail + roster load instantly when a row opens it.
  useTrainingDetail.mockReturnValue({ isPending: false, isError: false, error: null, data: DETAIL });
  useRoster.mockReturnValue({ isPending: false, isError: false, error: null, data: ROSTER });
  useTrainingWaitlist.mockReturnValue({ isPending: false, isError: false, error: null, data: [] });
});

afterEach(cleanup);

/** Set a from/to range so `useTrainings` is queried (the page gates on it). */
function setRange(): void {
  fireEvent.change(screen.getByLabelText("С даты"), { target: { value: "2026-07-01" } });
  fireEvent.change(screen.getByLabelText("По дату"), { target: { value: "2026-07-31" } });
}

/** ISO `yyyy-mm-dd` first/last day of the current calendar month (mirrors the page). */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  const iso = (d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { from: iso(1), to: iso(last) };
}

/** The last query object passed to the (mocked) useTrainings hook. */
function lastTrainingsQuery(): { from?: string; to?: string; includeTerminal?: boolean } | null {
  const calls = useTrainings.mock.calls;
  return (calls.at(-1)?.[0] ?? null) as {
    from?: string;
    to?: string;
    includeTerminal?: boolean;
  } | null;
}

/** The last query object passed to the (mocked) useTrainingsCalendar hook. */
function lastCalendarQuery(): { includeTerminal?: boolean } | null {
  const calls = useTrainingsCalendar.mock.calls;
  return (calls.at(-1)?.[0] ?? null) as { includeTerminal?: boolean } | null;
}

function trainingTableRows(): HTMLElement[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(2);
}

function openEditForRow(rowIndex = 0): HTMLElement {
  const row = trainingTableRows()[rowIndex];
  fireEvent.click(within(row).getByRole("button", { name: "Изменить" }));
  return screen.getByRole("dialog", { name: "Изменить" });
}

function openIndividualGenerationDialog(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Сгенерировать индивидуальные" }));
  return screen.getByRole("dialog", { name: "Индивидуальные тренировки (1-на-1)" });
}

function fillIndividualGenerationForm(
  dialog: HTMLElement,
  times: { startTime?: string; endTime?: string } = {}
): void {
  fireEvent.change(within(dialog).getByLabelText("Клиент"), { target: { value: CLIENT.id } });
  fireEvent.change(within(dialog).getByLabelText("Тренер"), { target: { value: TRAINER.id } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Понедельник" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Среда" }));
  fireEvent.change(within(dialog).getByLabelText("Начало"), {
    target: { value: times.startTime ?? "18:00" }
  });
  fireEvent.change(within(dialog).getByLabelText("Окончание"), {
    target: { value: times.endTime ?? "19:00" }
  });
  fireEvent.change(within(dialog).getByLabelText("Год"), { target: { value: "2026" } });
  fireEvent.change(within(dialog).getByLabelText("Месяц"), { target: { value: "7" } });
  fireEvent.change(within(dialog).getByLabelText("Цена за тренировку, RSD"), {
    target: { value: "2500" }
  });
}

describe("Trainings page", () => {
  it("queries the current month on first render and shows rows (not the pick-range placeholder)", () => {
    render(<Trainings />);

    // The range defaults to the current calendar month, so the query is live…
    const range = currentMonthRange();
    expect(lastTrainingsQuery()).toMatchObject({ from: range.from, to: range.to });
    // …and the table renders straight away without the user picking a range.
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("2026-07-06")).toBeTruthy();
    expect(
      screen.queryByText("Укажите период (с даты и по дату), чтобы увидеть тренировки.")
    ).toBeNull();
  });

  it("omits terminal statuses by default and includes them only when requested", () => {
    render(<Trainings />);

    const range = currentMonthRange();
    expect(lastTrainingsQuery()).toMatchObject({ from: range.from, to: range.to });
    expect(lastTrainingsQuery()).not.toHaveProperty("includeTerminal");

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Показать заверш[её]нные и отмен[её]нные/ })
    );

    expect(lastTrainingsQuery()).toMatchObject({
      from: range.from,
      to: range.to,
      includeTerminal: true
    });
  });

  it("omits terminal statuses in the calendar until requested", () => {
    render(<Trainings />);

    fireEvent.click(screen.getByRole("button", { name: /Календарь/ }));
    expect(lastCalendarQuery()).not.toHaveProperty("includeTerminal");

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Показать заверш[её]нные и отмен[её]нные/ })
    );

    expect(lastCalendarQuery()).toMatchObject({ includeTerminal: true });
  });

  it("moves the range to the generated month after a successful generate", () => {
    const mutate = vi.fn((_input, opts: { onSuccess: (r: unknown[]) => void }) =>
      opts.onSuccess([])
    );
    useGenerateMonth.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);

    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать месяц" }));
    const dialog = screen.getByRole("dialog", { name: "Сгенерировать месяц" });
    fireEvent.change(within(dialog).getByLabelText("Группа"), { target: { value: GROUP.id } });
    fireEvent.change(within(dialog).getByLabelText("Год"), { target: { value: "2026" } });
    fireEvent.change(within(dialog).getByLabelText("Месяц"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сгенерировать" }));

    // The table range now points at the generated month so new rows are visible.
    expect(lastTrainingsQuery()).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

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

  it("opens a row's roster with attendee names and drop-in vs subscription badges", () => {
    render(<Trainings />);
    setRange();

    const table = screen.getByRole("table");
    const row = within(table).getByText("2026-07-06").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Записанные" }));

    const dialog = screen.getByRole("dialog", { name: "Тренировка" });
    // The headcount and both attendees come straight from the roster contract.
    expect(within(dialog).getByText("Записано: 2")).toBeTruthy();

    const igor = within(dialog).getByText("Игорь").closest("tr") as HTMLElement;
    expect(within(igor).getByText("Разовое")).toBeTruthy();

    const maria = within(dialog).getByText("Мария").closest("tr") as HTMLElement;
    expect(within(maria).getByText("Абонемент")).toBeTruthy();
  });

  it("prompts before deleting and only calls the mutation (over the id) on confirm", () => {
    const mutate = vi.fn();
    useDeleteTraining.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);
    setRange();

    // The row action opens the confirm dialog; the mutation has not fired yet.
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить тренировку" });
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить тренировку" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    // The delete mutation takes the training id directly (DELETE /trainings/:id).
    expect(mutate.mock.calls[0][0]).toBe(TRAINING.id);
  });

  it("notifies on a successful delete (no booked-count in the toast)", () => {
    const mutate = vi.fn((_id, opts: { onSuccess: () => void }) => opts.onSuccess());
    useDeleteTraining.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить тренировку" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить тренировку" }));

    expect(notify).toHaveBeenCalledWith(
      "Тренировка отменена и скрыта. Записанные клиенты уведомлены.",
      "success"
    );
  });

  it("keeps the delete action enabled for a cancelled training (still deletable)", () => {
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [{ ...TRAINING, status: "cancelled" }]
    });
    render(<Trainings />);
    setRange();
    expect(
      screen.getByRole("button", { name: "Удалить" }).hasAttribute("disabled")
    ).toBe(false);
  });

  it("disables the delete action for a completed training (no longer removable)", () => {
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [{ ...TRAINING, status: "completed" }]
    });
    render(<Trainings />);
    setRange();
    expect(
      screen.getByRole("button", { name: "Удалить" }).hasAttribute("disabled")
    ).toBe(true);
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

  it("marks an already fully-generated group disabled in the generate-month modal", () => {
    useGenerationStatus.mockReturnValue(
      idleQuery([
        {
          groupId: GROUP.id,
          groupName: GROUP.name,
          expected: 8,
          existing: 8,
          fullyGenerated: true
        }
      ])
    );
    render(<Trainings />);

    fireEvent.click(screen.getByRole("button", { name: "Сгенерировать месяц" }));
    const dialog = screen.getByRole("dialog", { name: "Сгенерировать месяц" });
    const option = within(dialog).getByRole("option", {
      name: "Утренняя группа (готово)"
    }) as HTMLOptionElement;
    // The status query is honoured: the group is shown but cannot be selected.
    expect(option.disabled).toBe(true);
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

    const dialog = openEditForRow();
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
    // The bonus checkbox is hidden for a zero-balance client, so the flag is false.
    expect(mutate.mock.calls[0][0]).toEqual({
      clientId: CLIENT.id,
      trainingId: TRAINING.id,
      useBonusCredit: false
    });
  });

  it("redeems a bonus credit when the box is checked for a balance-bearing client", () => {
    const bonusClient: Client = { ...CLIENT, source: "telegram", bonusTrainingCredits: 3 };
    const mutate = vi.fn();
    useClientsList.mockReturnValue(idleQuery([bonusClient]));
    useBookManual.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Добавить человека" }));
    const dialog = screen.getByRole("dialog", { name: "Добавить человека на тренировку" });
    fireEvent.change(within(dialog).getByLabelText("Выберите клиента"), {
      target: { value: bonusClient.id }
    });
    // The bonus checkbox only appears for a client with a balance; tick it.
    fireEvent.click(within(dialog).getByLabelText("Использовать бонус (доступно: 3)"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Записать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      clientId: bonusClient.id,
      trainingId: TRAINING.id,
      useBonusCredit: true
    });
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
    // A walk-in never has a bonus balance, so the redeem flag is always false.
    expect(bookMutate).toHaveBeenCalledTimes(1);
    expect(bookMutate.mock.calls[0][0]).toEqual({
      clientId: CLIENT.id,
      trainingId: TRAINING.id,
      useBonusCredit: false
    });
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

  it("disables Add person on a full group training (server is still authoritative)", () => {
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

  it("keeps Add person usable on a full individual training and submits the picked client", () => {
    const mutate = vi.fn();
    useBookManual.mockReturnValue({ ...idleMutation(), mutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [{ ...INDIVIDUAL, status: "full", capacity: 1, bookedCount: 1 }]
    });
    render(<Trainings />);
    setRange();

    const button = screen.getByRole("button", { name: "Добавить человека" });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);

    const dialog = screen.getByRole("dialog", { name: "Добавить человека на тренировку" });
    fireEvent.change(within(dialog).getByLabelText("Выберите клиента"), {
      target: { value: CLIENT.id }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Записать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      clientId: CLIENT.id,
      trainingId: INDIVIDUAL.id,
      useBonusCredit: false
    });
  });

  it("makes @username search clear in Add Person and shows usernames in options", () => {
    useClientsList.mockReturnValue(idleQuery([{ ...CLIENT, telegramUsername: "marko" }]));
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Добавить человека" }));
    const dialog = screen.getByRole("dialog", { name: "Добавить человека на тренировку" });

    expect(within(dialog).getByPlaceholderText("Имя, телефон или @username")).toBeTruthy();
    expect(
      within(dialog).getByRole("option", {
        name: `${CLIENT.name} · @marko · ${CLIENT.phone}`
      })
    ).toBeTruthy();
  });

  it("labels a group training, an individual training, and a one-off distinctly", () => {
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [TRAINING, INDIVIDUAL, { ...TRAINING, id: "one-off", groupId: null, clientId: null }]
    });
    render(<Trainings />);
    setRange();

    const table = screen.getByRole("table");
    // Group training shows the group name; the individual one a dedicated label;
    // the plain group-less/client-less row stays "Разовая".
    const rowText = within(table)
      .getAllByRole("row")
      .slice(2)
      .map((row) => row.textContent ?? "")
      .join("\n");
    expect(rowText).toContain("Утренняя группа");
    expect(rowText).toContain("Индивидуальная");
    expect(rowText).toContain("Разовая");
  });

  it("uses stable group filter values and keeps table controls out of the server query", () => {
    const collidingGroup: Group = {
      ...GROUP,
      id: "66666666-6666-4666-8666-666666666666",
      name: "Индивидуальная"
    };
    const collidingTraining: Training = {
      ...TRAINING,
      id: "77777777-7777-4777-8777-777777777777",
      groupId: collidingGroup.id,
      date: "2026-07-08"
    };
    useGroups.mockReturnValue({ data: [GROUP, collidingGroup] });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [INDIVIDUAL, collidingTraining]
    });
    render(<Trainings />);
    setRange();

    const expectedQuery = { from: "2026-07-01", to: "2026-07-31" };
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: /Дата/ }));
    const groupFilter = screen.getByLabelText("Фильтр: Группа") as HTMLSelectElement;
    const individualOptions = within(groupFilter).getAllByRole("option", {
      name: "Индивидуальная"
    }) as HTMLOptionElement[];

    expect(individualOptions).toHaveLength(2);
    expect(individualOptions[1].value).toBe(collidingGroup.id);
    fireEvent.change(groupFilter, { target: { value: individualOptions[1].value } });

    expect(lastTrainingsQuery()).toEqual(expectedQuery);
    expect(within(table).getByText("2026-07-08")).toBeTruthy();
    expect(within(table).queryByText("2026-07-07")).toBeNull();
  });

  it("keeps sorted/filtered training row actions bound to the correct row id", () => {
    const callOrder: string[] = [];
    const scheduleMutate = vi.fn((_input: unknown, opts?: { onSuccess?: () => void }) => {
      callOrder.push("schedule");
      opts?.onSuccess?.();
    });
    const rescheduleMutate = vi.fn();
    const capacityMutate = vi.fn();
    const priceMutate = vi.fn();
    const bookMutate = vi.fn();
    useRescheduleTraining.mockReturnValue({ ...idleMutation(), mutate: rescheduleMutate });
    useChangeCapacity.mockReturnValue({ ...idleMutation(), mutate: capacityMutate });
    useUpdateIndividualPrice.mockReturnValue({ ...idleMutation(), mutate: priceMutate });
    useUpdateTrainingSchedule.mockReturnValue({ ...idleMutation(), mutate: scheduleMutate });
    useBookManual.mockReturnValue({ ...idleMutation(), mutate: bookMutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [TRAINING, INDIVIDUAL]
    });
    render(<Trainings />);
    setRange();

    const expectedQuery = { from: "2026-07-01", to: "2026-07-31" };
    const table = screen.getByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: /Дата/ }));
    fireEvent.change(screen.getByLabelText("Фильтр: Время"), {
      target: { value: "18:00–19:00" }
    });

    expect(lastTrainingsQuery()).toEqual(expectedQuery);
    expect(trainingTableRows()).toHaveLength(1);
    expect(within(trainingTableRows()[0]).getByText("Индивидуальная")).toBeTruthy();

    fireEvent.click(within(trainingTableRows()[0]).getByRole("button", { name: "Записанные" }));
    expect(useTrainingDetail.mock.calls.at(-1)?.[0]).toBe(INDIVIDUAL.id);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));

    expect(within(trainingTableRows()[0]).queryByRole("button", { name: "Изменить время" })).toBeNull();
    expect(within(trainingTableRows()[0]).queryByRole("button", { name: "Вместимость" })).toBeNull();
    expect(within(trainingTableRows()[0]).queryByRole("button", { name: "Цена" })).toBeNull();

    let dialog = openEditForRow(0);
    fireEvent.change(within(dialog).getByLabelText("Начало"), { target: { value: "19:30" } });
    fireEvent.change(within(dialog).getByLabelText("Окончание"), { target: { value: "20:30" } });
    const capacityInput = within(dialog).getByLabelText("Вместимость") as HTMLInputElement;
    expect(capacityInput.getAttribute("max")).toBe("2");
    fireEvent.change(capacityInput, { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Цена за тренировку, RSD"), {
      target: { value: "2700" }
    });
    fireEvent.change(within(dialog).getByLabelText("Корт"), {
      target: { value: COURTS[1].id }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(callOrder).toEqual(["schedule"]);
    expect(rescheduleMutate).not.toHaveBeenCalled();
    expect(scheduleMutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { startTime: "19:30", endTime: "20:30", courtId: COURTS[1].id }
    });
    expect(capacityMutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { capacity: 2 }
    });
    expect(priceMutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { priceSingleRsd: 2700 },
      series: false
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));

    fireEvent.click(within(trainingTableRows()[0]).getByRole("button", { name: "Добавить человека" }));
    dialog = screen.getByRole("dialog", { name: "Добавить человека на тренировку" });
    fireEvent.change(within(dialog).getByLabelText("Выберите клиента"), {
      target: { value: CLIENT.id }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Записать" }));
    expect(bookMutate.mock.calls[0][0]).toEqual({
      clientId: CLIENT.id,
      trainingId: INDIVIDUAL.id,
      useBonusCredit: false
    });
  });

  it("blocks individual generation when the end time is not after the start time", () => {
    const mutate = vi.fn();
    useGenerateIndividualMonth.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);

    const dialog = openIndividualGenerationDialog();
    fillIndividualGenerationForm(dialog, { startTime: "19:00", endTime: "19:00" });
    const submit = within(dialog).getByRole("button", { name: "Сгенерировать" });

    expect(within(dialog).getByRole("alert").textContent).toBeTruthy();
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.click(submit);

    expect(mutate).not.toHaveBeenCalled();
  });

  it("generates individual trainings with the chosen client/trainer/days/time/price", () => {
    const mutate = vi.fn();
    useGenerateIndividualMonth.mockReturnValue({ ...idleMutation(), mutate });
    render(<Trainings />);

    const dialog = openIndividualGenerationDialog();
    fillIndividualGenerationForm(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Сгенерировать" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      clientId: CLIENT.id,
      trainerId: TRAINER.id,
      daysOfWeek: [1, 3],
      startTime: "18:00",
      endTime: "19:00",
      year: 2026,
      month: 7,
      priceSingleRsd: 2500
    });
  });

  it("opens the unified edit modal for a group training without individual-only controls", () => {
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();
    // Group trainings do not expose individual time/price controls or series scope.
    expect(within(dialog).queryByLabelText("Что изменить")).toBeNull();
    expect(within(dialog).queryByLabelText("Начало")).toBeNull();
    expect(within(dialog).queryByLabelText("Окончание")).toBeNull();
    expect(within(dialog).queryByLabelText("Цена за тренировку, RSD")).toBeNull();
    expect(within(dialog).getByLabelText("Вместимость")).toBeTruthy();
    expect(within(dialog).getByLabelText("Корт")).toBeTruthy();
  });

  it("seeds the edit modal with the current court and PATCHes a court-only schedule change", () => {
    const mutate = vi.fn();
    useUpdateTrainingSchedule.mockReturnValue({ ...idleMutation(), mutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [{ ...TRAINING, courtId: COURTS[0].id, courtNumber: 1 }]
    });
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();
    const courtSelect = within(dialog).getByLabelText("Корт") as HTMLSelectElement;
    expect(courtSelect.value).toBe(COURTS[0].id);
    expect(within(dialog).queryByRole("option", { name: "Без изменений" })).toBeNull();

    fireEvent.change(courtSelect, { target: { value: COURTS[1].id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: TRAINING.id,
      input: { courtId: COURTS[1].id }
    });
  });

  it("shows the API 409 schedule error without closing the edit modal", () => {
    useUpdateTrainingSchedule.mockReturnValue({
      ...idleMutation(),
      isError: true,
      error: new Error("Корт уже занят на это время.")
    });
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();

    expect(within(dialog).getByRole("alert").textContent).toContain("Корт уже занят на это время.");
  });

  it("reschedules the whole series when chosen for an individual training", () => {
    const mutate = vi.fn();
    useRescheduleTraining.mockReturnValue({ ...idleMutation(), mutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [INDIVIDUAL]
    });
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();
    // The individual row offers the series scope; pick it and submit the new window.
    fireEvent.change(within(dialog).getAllByLabelText("Что изменить")[0], {
      target: { value: "series" }
    });
    fireEvent.change(within(dialog).getByLabelText("Начало"), { target: { value: "19:00" } });
    fireEvent.change(within(dialog).getByLabelText("Окончание"), { target: { value: "20:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { startTime: "19:00", endTime: "20:00" },
      series: true
    });
  });

  it("disables court changes when rescheduling an individual series", () => {
    const rescheduleMutate = vi.fn();
    const scheduleMutate = vi.fn();
    useRescheduleTraining.mockReturnValue({ ...idleMutation(), mutate: rescheduleMutate });
    useUpdateTrainingSchedule.mockReturnValue({ ...idleMutation(), mutate: scheduleMutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [INDIVIDUAL]
    });
    useTrainingDetail.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        ...DETAIL,
        id: INDIVIDUAL.id,
        groupId: null,
        date: INDIVIDUAL.date,
        startTime: INDIVIDUAL.startTime,
        endTime: INDIVIDUAL.endTime,
        capacity: INDIVIDUAL.capacity,
        bookedCount: INDIVIDUAL.bookedCount,
        priceSingleRsd: INDIVIDUAL.priceSingleRsd,
        clientId: INDIVIDUAL.clientId,
        status: INDIVIDUAL.status,
        courtId: COURTS[0].id,
        courtNumber: 1
      }
    });
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();
    const courtSelect = within(dialog).getByLabelText("Корт") as HTMLSelectElement;
    expect(courtSelect.value).toBe(COURTS[0].id);

    fireEvent.change(courtSelect, { target: { value: COURTS[1].id } });
    expect(courtSelect.value).toBe(COURTS[1].id);
    fireEvent.change(within(dialog).getAllByLabelText("Что изменить")[0], {
      target: { value: "series" }
    });

    expect(courtSelect.value).toBe(COURTS[0].id);
    expect(courtSelect).toHaveProperty("disabled", true);

    fireEvent.change(within(dialog).getByLabelText("Начало"), { target: { value: "19:00" } });
    fireEvent.change(within(dialog).getByLabelText("Окончание"), { target: { value: "20:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(scheduleMutate).not.toHaveBeenCalled();
    expect(rescheduleMutate).toHaveBeenCalledTimes(1);
    expect(rescheduleMutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { startTime: "19:00", endTime: "20:00" },
      series: true
    });
  });

  it("updates one individual training price", () => {
    const mutate = vi.fn();
    useUpdateIndividualPrice.mockReturnValue({ ...idleMutation(), mutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [INDIVIDUAL]
    });
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();
    fireEvent.change(within(dialog).getByLabelText("Цена за тренировку, RSD"), {
      target: { value: "3000" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { priceSingleRsd: 3000 },
      series: false
    });
  });

  it("updates the future individual price series when selected", () => {
    const mutate = vi.fn();
    useUpdateIndividualPrice.mockReturnValue({ ...idleMutation(), mutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [INDIVIDUAL]
    });
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();
    fireEvent.change(within(dialog).getAllByLabelText("Что изменить")[1], {
      target: { value: "series" }
    });
    fireEvent.change(within(dialog).getByLabelText("Цена за тренировку, RSD"), {
      target: { value: "3200" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { priceSingleRsd: 3200 },
      series: true
    });
  });

  it("clears an individual training price with null", () => {
    const mutate = vi.fn();
    useUpdateIndividualPrice.mockReturnValue({ ...idleMutation(), mutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [INDIVIDUAL]
    });
    render(<Trainings />);
    setRange();

    const dialog = openEditForRow();
    fireEvent.change(within(dialog).getByLabelText("Цена за тренировку, RSD"), {
      target: { value: "" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      id: INDIVIDUAL.id,
      input: { priceSingleRsd: null },
      series: false
    });
  });

  it("deletes an individual future series when selected in the delete modal", () => {
    const mutate = vi.fn();
    useDeleteTrainingSeries.mockReturnValue({ ...idleMutation(), mutate });
    useTrainings.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: [INDIVIDUAL]
    });
    render(<Trainings />);
    setRange();

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить тренировку" });
    fireEvent.change(within(dialog).getByLabelText("Что удалить"), {
      target: { value: "series" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить тренировку" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe(INDIVIDUAL.id);
  });
});
