import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Court, Group, GroupMembers, Level, Trainer } from "@beosand/types";
import { ToastProvider } from "../ui/Toast";

// AppShell pulls in the router + session hooks; stub it to a passthrough so the
// test stays focused on the Groups screen's render/validation/mutation wiring.
vi.mock("../ui/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

vi.mock("../i18n/LanguageProvider", async () => import("../i18n/test-utils"));

const useGroups = vi.fn();
const useCreateGroup = vi.fn();
const useUpdateGroup = vi.fn();
const useDeleteGroup = vi.fn();
const useLevels = vi.fn();
const useTrainers = vi.fn();
const useCourts = vi.fn();
const useGroupMembers = vi.fn();
const useTransferGroupMember = vi.fn();

vi.mock("../hooks/useGroups", () => ({
  useGroups: () => useGroups(),
  useCreateGroup: () => useCreateGroup(),
  useUpdateGroup: () => useUpdateGroup(),
  useDeleteGroup: () => useDeleteGroup()
}));
vi.mock("../hooks/useGroupMembers", () => ({
  useGroupMembers: () => useGroupMembers(),
  useTransferGroupMember: () => useTransferGroupMember()
}));
vi.mock("../hooks/useLevels", () => ({ useLevels: () => useLevels() }));
vi.mock("../hooks/useTrainers", () => ({ useTrainers: () => useTrainers() }));
vi.mock("../hooks/useCourts", () => ({ useCourts: () => useCourts() }));

import { Groups } from "./Groups";

const LEVEL: Level = { id: "11111111-1111-1111-1111-111111111111", name: "Начинающие", status: "active" };
const COURT: Court = { id: "66666666-6666-6666-6666-666666666666", number: 1, status: "active" };
const TRAINER: Trainer = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Анна",
  type: "main",
  status: "active",
  telegramId: null,
  telegramUsername: null,
  language: "sr",
  individualVisible: true
};
const GROUP: Group = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Утренняя группа",
  levelId: LEVEL.id,
  daysOfWeek: [1, 3],
  startTime: "08:00",
  endTime: "09:30",
  trainerId: TRAINER.id,
  trainerName: TRAINER.name,
  courtId: null,
  courtNumber: null,
  capacity: 12,
  priceSingleRsd: 1500,
  priceMonthRsd: 12000,
  hidden: false,
  status: "active"
};
const GROUP_B: Group = {
  ...GROUP,
  id: "44444444-4444-4444-4444-444444444444",
  name: "Вечерняя группа"
};
const CLIENT_ID = "55555555-5555-5555-5555-555555555555";
const MEMBERS: GroupMembers = {
  groupId: GROUP.id,
  year: 2026,
  month: 6,
  memberCount: 1,
  callerSubscribed: false,
  members: [
    {
      firstName: "Ана",
      avatarInitial: "А",
      telegramPhotoUrl: null,
      clientId: CLIENT_ID,
      fullName: "Ана Петровић"
    }
  ]
};

function query<T>(over: Partial<{ data: T; isLoading: boolean; isError: boolean }>) {
  return { data: undefined, isLoading: false, isError: false, ...over };
}

function mutation(over: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

function renderPage(): void {
  render(
    <ToastProvider>
      <Groups />
    </ToastProvider>
  );
}

beforeEach(() => {
  useGroups.mockReturnValue(query<Group[]>({ data: [GROUP, GROUP_B] }));
  useCreateGroup.mockReturnValue(mutation());
  useUpdateGroup.mockReturnValue(mutation());
  useDeleteGroup.mockReturnValue(mutation());
  useLevels.mockReturnValue(query<Level[]>({ data: [LEVEL] }));
  useTrainers.mockReturnValue(query<Trainer[]>({ data: [TRAINER] }));
  useCourts.mockReturnValue(query<Court[]>({ data: [COURT] }));
  useGroupMembers.mockReturnValue(query<GroupMembers>({ data: MEMBERS }));
  useTransferGroupMember.mockReturnValue(mutation());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Groups", () => {
  it("renders validated group rows with formatted days, time and RSD prices", () => {
    renderPage();
    const table = screen.getByRole("table", { name: "Группы тренировок" });
    const row = within(table).getByText("Утренняя группа").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText("Пн, Ср")).toBeTruthy();
    expect(cells.getByText("08:00–09:30")).toBeTruthy();
    expect(cells.getByText("Анна")).toBeTruthy();
    expect(cells.getByText("Начинающие")).toBeTruthy();
    // formatRsd renders whole dinars with a ru-RU thousands separator.
    expect(cells.getByText("1 500 RSD")).toBeTruthy();
    expect(cells.getByText("12 000 RSD")).toBeTruthy();
  });

  it("filters loaded groups by name, weekday, level, trainer, court, status and visibility", () => {
    const otherLevel: Level = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Продвинутые",
      status: "active"
    };
    const otherTrainer: Trainer = {
      ...TRAINER,
      id: "88888888-8888-4888-8888-888888888888",
      name: "Марко"
    };
    const otherCourt: Court = {
      id: "99999999-9999-4999-8999-999999999999",
      number: 2,
      status: "active"
    };
    const target: Group = {
      ...GROUP,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Фильтр цель",
      daysOfWeek: [5],
      levelId: otherLevel.id,
      trainerId: otherTrainer.id,
      trainerName: otherTrainer.name,
      courtId: otherCourt.id,
      courtNumber: otherCourt.number,
      status: "inactive",
      hidden: true
    };
    const distractor: Group = {
      ...GROUP,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Фильтр мимо",
      daysOfWeek: [5],
      levelId: otherLevel.id,
      trainerId: otherTrainer.id,
      trainerName: otherTrainer.name,
      courtId: otherCourt.id,
      courtNumber: otherCourt.number,
      status: "inactive",
      hidden: false
    };
    useGroups.mockReturnValue(query<Group[]>({ data: [GROUP, target, distractor] }));
    useLevels.mockReturnValue(query<Level[]>({ data: [LEVEL, otherLevel] }));
    useTrainers.mockReturnValue(query<Trainer[]>({ data: [TRAINER, otherTrainer] }));
    useCourts.mockReturnValue(query<Court[]>({ data: [COURT, otherCourt] }));

    renderPage();

    fireEvent.change(screen.getByLabelText("Поиск по названию"), {
      target: { value: "цель" }
    });
    fireEvent.change(screen.getByLabelText("День"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Уровень"), { target: { value: otherLevel.id } });
    fireEvent.change(screen.getByLabelText("Тренер"), { target: { value: otherTrainer.id } });
    fireEvent.change(screen.getByLabelText("Корт"), { target: { value: otherCourt.id } });
    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "inactive" } });
    fireEvent.change(screen.getByLabelText("Видимость для клиентов"), {
      target: { value: "hidden" }
    });

    const table = screen.getByRole("table", { name: "Группы тренировок" });
    expect(within(table).getByText("Фильтр цель")).toBeTruthy();
    expect(within(table).queryByText("Фильтр мимо")).toBeNull();
    expect(within(table).queryByText("Утренняя группа")).toBeNull();
  });

  it("renders the visibility column from group.hidden (shown vs hidden)", () => {
    const hiddenGroup: Group = { ...GROUP_B, name: "Скрытая группа", hidden: true };
    useGroups.mockReturnValue(query<Group[]>({ data: [GROUP, hiddenGroup] }));
    renderPage();
    const table = screen.getByRole("table", { name: "Группы тренировок" });

    const visibleRow = within(table).getByText("Утренняя группа").closest("tr") as HTMLElement;
    expect(within(visibleRow).getByText("Показывается")).toBeTruthy();

    const hiddenRow = within(table).getByText("Скрытая группа").closest("tr") as HTMLElement;
    expect(within(hiddenRow).getByText("Скрыта")).toBeTruthy();
  });

  it("includes hidden in the update payload when editing a group's visibility", () => {
    const mutate = vi.fn();
    useUpdateGroup.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Изменить группу Утренняя группа" }));
    const dialog = screen.getByRole("dialog", { name: "Изменить группу" });
    const inDialog = within(dialog);

    // The visibility control is present only in edit mode and defaults to the group's value.
    const visibility = inDialog.getByLabelText("Видимость для клиентов") as HTMLSelectElement;
    expect(visibility.value).toBe("visible");
    fireEvent.change(visibility, { target: { value: "hidden" } });

    fireEvent.click(inDialog.getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [args] = mutate.mock.calls[0];
    expect(args.id).toBe(GROUP.id);
    expect(args.input).toMatchObject({ hidden: true });
  });

  it("omits the visibility control when creating a group", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    const dialog = screen.getByRole("dialog", { name: "Создать группу" });
    expect(within(dialog).queryByLabelText("Видимость для клиентов")).toBeNull();
  });

  it("orders rows by first weekday then start time, regardless of input order", () => {
    // Out-of-order input: later weekday first, and a same-weekday pair where the
    // earlier start time is supplied second.
    const friday: Group = { ...GROUP, id: "a1", name: "Пятница", daysOfWeek: [5], startTime: "10:00" };
    const tuesdayLate: Group = {
      ...GROUP,
      id: "a2",
      name: "Вторник поздно",
      daysOfWeek: [2, 4],
      startTime: "19:00"
    };
    const tuesdayEarly: Group = {
      ...GROUP,
      id: "a3",
      name: "Вторник рано",
      daysOfWeek: [2],
      startTime: "07:30"
    };
    const monday: Group = { ...GROUP, id: "a4", name: "Понедельник", daysOfWeek: [3, 1], startTime: "08:00" };
    useGroups.mockReturnValue(
      query<Group[]>({ data: [friday, tuesdayLate, tuesdayEarly, monday] })
    );

    renderPage();

    const table = screen.getByRole("table", { name: "Группы тренировок" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const names = bodyRows.map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(names).toEqual([
      "Понедельник", // min day 1
      "Вторник рано", // min day 2, 07:30
      "Вторник поздно", // min day 2, 19:00
      "Пятница" // min day 5
    ]);
  });

  it("shows the loading state while groups are fetching", () => {
    useGroups.mockReturnValue(query<Group[]>({ isLoading: true }));
    renderPage();
    expect(screen.getByText("Загрузка групп…")).toBeTruthy();
  });

  it("shows an error state when the groups query fails", () => {
    useGroups.mockReturnValue(query<Group[]>({ isError: true }));
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить группы");
  });

  it("shows an empty hint when there are no groups", () => {
    useGroups.mockReturnValue(query<Group[]>({ data: [] }));
    renderPage();
    expect(screen.getByText("Групп пока нет. Создайте первую.")).toBeTruthy();
  });

  it("submits the create mutation with the form contract when creating a group", () => {
    const mutate = vi.fn();
    useCreateGroup.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    const dialog = screen.getByRole("dialog", { name: "Создать группу" });
    const inDialog = within(dialog);

    fireEvent.change(inDialog.getByLabelText("Название"), { target: { value: "Вечерняя группа" } });
    fireEvent.change(inDialog.getByLabelText("Уровень"), { target: { value: LEVEL.id } });
    fireEvent.change(inDialog.getByLabelText("Тренер"), { target: { value: TRAINER.id } });
    fireEvent.click(inDialog.getByRole("button", { name: "Понедельник" }));
    fireEvent.change(inDialog.getByLabelText("Начало"), { target: { value: "18:00" } });
    fireEvent.change(inDialog.getByLabelText("Конец"), { target: { value: "19:30" } });
    fireEvent.change(inDialog.getByLabelText("Вместимость"), { target: { value: "10" } });
    fireEvent.change(inDialog.getByLabelText("Цена за занятие (RSD)"), { target: { value: "1600" } });
    fireEvent.change(inDialog.getByLabelText("Цена за месяц (RSD)"), { target: { value: "13000" } });

    fireEvent.click(inDialog.getByRole("button", { name: "Сохранить" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [input] = mutate.mock.calls[0];
    expect(input).toMatchObject({
      name: "Вечерняя группа",
      levelId: LEVEL.id,
      trainerId: TRAINER.id,
      daysOfWeek: [1],
      startTime: "18:00",
      endTime: "19:30",
      capacity: 10,
      priceSingleRsd: 1600,
      priceMonthRsd: 13000
    });
  });

  it("surfaces a rejected mutation's server error in the form", () => {
    useCreateGroup.mockReturnValue(
      mutation({ isError: true, error: new Error("Время окончания раньше начала") })
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Создать группу" }));
    const dialog = screen.getByRole("dialog", { name: "Создать группу" });
    expect(within(dialog).getByRole("alert").textContent).toContain(
      "Время окончания раньше начала"
    );
  });

  it("opens the members drawer and lists this month's members by full name", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Состав группы Утренняя группа" }));
    const drawer = screen.getByRole("dialog", { name: "Состав: Утренняя группа" });
    expect(within(drawer).getByText("Ана Петровић")).toBeTruthy();
  });

  it("renders member avatar+name and falls back to the initial when the photo fails", () => {
    useGroupMembers.mockReturnValue(
      query<GroupMembers>({
        data: {
          groupId: GROUP.id,
          year: 2026,
          month: 6,
          memberCount: 1,
          callerSubscribed: false,
          members: [
            {
              firstName: "Ana",
              avatarInitial: "A",
              clientId: CLIENT_ID,
              fullName: "Ana Petrovic",
              telegramPhotoUrl: "https://t.me/i/userpic/320/ana.jpg"
            } as GroupMembers["members"][number] & { telegramPhotoUrl: string }
          ]
        }
      })
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Состав группы Утренняя группа/ }));
    const drawer = screen.getByRole("dialog", { name: /Состав: Утренняя группа/ });
    const row = within(drawer).getByText("Ana Petrovic").closest("tr") as HTMLElement;
    const photo = row.querySelector("img") as HTMLImageElement;
    expect(photo.src).toBe("https://t.me/i/userpic/320/ana.jpg");

    fireEvent.error(photo);

    expect(within(row).getByText("A")).toBeTruthy();
    expect(row.querySelector("img")).toBeNull();
  });

  it("transfers a member to a chosen target group (source group excluded)", () => {
    const mutate = vi.fn();
    useTransferGroupMember.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Состав группы Утренняя группа" }));
    fireEvent.click(screen.getByRole("button", { name: "Перенести участника Ана Петровић" }));

    const dialog = screen.getByRole("dialog", { name: "Перенести: Ана Петровић" });
    const inDialog = within(dialog);
    const select = inDialog.getByLabelText("Целевая группа") as HTMLSelectElement;
    // The source group is not an option; only the other group is offered.
    expect(within(select).queryByText("Утренняя группа")).toBeNull();
    expect(within(select).getByText("Вечерняя группа")).toBeTruthy();

    fireEvent.change(select, { target: { value: GROUP_B.id } });
    fireEvent.click(inDialog.getByRole("button", { name: "Перенести" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [input] = mutate.mock.calls[0];
    expect(input).toMatchObject({
      clientId: CLIENT_ID,
      fromGroupId: GROUP.id,
      toGroupId: GROUP_B.id
    });
    expect(typeof input.year).toBe("number");
    expect(typeof input.month).toBe("number");
  });

  it("deletes a group via the mutation after the confirm dialog", () => {
    const mutate = vi.fn();
    useDeleteGroup.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Удалить группу Утренняя группа" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить группу" });
    // The confirm copy warns the group is hidden and its future trainings cancelled.
    expect(within(dialog).getByText(/будущие тренировки отменены/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить группу" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe(GROUP.id);
  });

  it("does not call the delete mutation until the action is confirmed", () => {
    const mutate = vi.fn();
    useDeleteGroup.mockReturnValue(mutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Удалить группу Утренняя группа" }));
    fireEvent.click(screen.getByRole("button", { name: "Не удалять" }));

    expect(mutate).not.toHaveBeenCalled();
  });
});
