import { InlineKeyboard } from "grammy";

/** Main-menu actions (UX scenario, section 2). */
export const MENU_ACTIONS = {
  availableTrainings: "menu:available",
  todayFreeSlots: "menu:today",
  joinGroup: "menu:group",
  myBookings: "menu:bookings",
  contactManager: "menu:contact"
} as const;

export type MenuAction = (typeof MENU_ACTIONS)[keyof typeof MENU_ACTIONS];

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🏐 Доступные тренировки", MENU_ACTIONS.availableTrainings)
    .row()
    .text("📅 Свободные места сегодня", MENU_ACTIONS.todayFreeSlots)
    .row()
    .text("👥 Записаться в группу", MENU_ACTIONS.joinGroup)
    .row()
    .text("📋 Мои записи", MENU_ACTIONS.myBookings)
    .row()
    .text("ℹ️ Связаться с менеджером", MENU_ACTIONS.contactManager);
}

export const WELCOME_TEXT = [
  "Добро пожаловать в BeoSand 🏐",
  "",
  "Здесь вы можете:",
  "• записаться на тренировку",
  "• посмотреть свободные места",
  "• увидеть свои записи"
].join("\n");
