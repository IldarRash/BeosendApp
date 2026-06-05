/**
 * RU bot-namespace strings (authoritative). All bot.* keys live here.
 *
 * The bot extraction agent ADDS the bot.* keys to this file and mirrors the SAME
 * keys into ../sr/bot.ts and ../en/bot.ts (placeholders = RU until the
 * translation phase). Do not put admin.* keys here — those belong in ../ru/admin.ts.
 *
 * `{param}` tokens are interpolated by the shared resolver `t()`; keep them
 * identical across locales. Prices/dates/counts are server-provided and passed
 * in as params — no money or availability math lives in these strings.
 */
export const botRu: Record<string, string> = {
  // --- Proof-of-shape keys (seeded by the foundation) ---
  "bot.menu.welcome": "Добро пожаловать в BeoSand!",
  "bot.menu.back": "Назад",
  "bot.action.confirm": "Подтвердить",

  // --- Main menu (menu.ts) ---
  "bot.menu.welcomeFull":
    "Добро пожаловать в BeoSand 🏐\n\nЗдесь вы можете:\n• записаться на тренировку\n• посмотреть свободные места\n• увидеть свои записи",
  "bot.menu.availableTrainings": "🎫 Разовое посещение",
  "bot.menu.todayFreeSlots": "📅 Свободные места сегодня",
  "bot.menu.joinGroup": "👥 Записаться в группу",
  "bot.menu.individual": "🧑‍🏫 Индивидуальная тренировка",
  "bot.menu.myBookings": "📋 Мои записи",
  "bot.menu.rentCourt": "🏖 Арендовать корт",
  "bot.menu.contactManager": "ℹ️ Связаться с менеджером",
  "bot.menu.language": "🌐 Язык / Language",
  "bot.menu.adminCourtModeration": "🛠 Заявки на корт (админ)",
  "bot.menu.adminCourtLoad": "📊 Загрузка кортов (админ)",
  "bot.menu.contactManagerLine": "Связаться с менеджером: {contact}",

  // --- Free spots today (navigation.ts, Feature 6) ---
  "bot.today.header": "Свободные места на сегодня:",
  "bot.today.none": "На сегодня свободных мест нет. Загляните позже 🙌",

  // --- Individual training (individual.ts, Feature 8) ---
  "bot.individual.pickTrainer": "К какому тренеру записаться?",
  "bot.individual.noTrainers": "Сейчас нет доступных тренеров. Загляните позже 🙌",
  "bot.individual.requested": "✅ Заявка отправлена тренеру. Он свяжется с вами в Telegram.",
  "bot.individual.trainerUnavailable":
    "Этот тренер пока недоступен в Telegram. Выберите другого или свяжитесь с менеджером.",
  "bot.individual.pickButton": "🧑‍🏫 {name}",

  // --- Shared navigation (menu.ts) ---
  "bot.nav.back": "⬅️ Назад",
  "bot.nav.home": "🏠 Главное меню",
  "bot.nav.toMenu": "⬅️ В меню",
  "bot.nav.menuShort": "🏠 Меню",

  // --- Language switch (menu.ts / index.ts) ---
  "bot.language.prompt": "Выберите язык / Choose your language:",
  "bot.language.changed": "Язык изменён. Текущий язык: {language}.",

  // --- Onboarding (onboarding.ts) ---
  "bot.onboarding.welcome":
    "Добро пожаловать в BeoSand 🏐\n\nДавайте познакомимся. Как вас зовут?",
  "bot.onboarding.askLevel": "Какой у вас уровень игры?",
  "bot.onboarding.askLanguage": "На каком языке вам удобнее? / Choose your language:",
  "bot.onboarding.levelNone": "🤷 Не знаю",

  // --- Weekday short labels (shared by several screens) ---
  "bot.weekday.short.1": "Пн",
  "bot.weekday.short.2": "Вт",
  "bot.weekday.short.3": "Ср",
  "bot.weekday.short.4": "Чт",
  "bot.weekday.short.5": "Пт",
  "bot.weekday.short.6": "Сб",
  "bot.weekday.short.7": "Вс",
  // --- Weekday full labels (stats) ---
  "bot.weekday.full.1": "Понедельник",
  "bot.weekday.full.2": "Вторник",
  "bot.weekday.full.3": "Среда",
  "bot.weekday.full.4": "Четверг",
  "bot.weekday.full.5": "Пятница",
  "bot.weekday.full.6": "Суббота",
  "bot.weekday.full.7": "Воскресенье",
  // --- Month names (group booking) ---
  "bot.month.1": "январь",
  "bot.month.2": "февраль",
  "bot.month.3": "март",
  "bot.month.4": "апрель",
  "bot.month.5": "май",
  "bot.month.6": "июнь",
  "bot.month.7": "июль",
  "bot.month.8": "август",
  "bot.month.9": "сентябрь",
  "bot.month.10": "октябрь",
  "bot.month.11": "ноябрь",
  "bot.month.12": "декабрь",

  // --- Available slots (slots.ts) ---
  "bot.slots.none": "Сейчас нет доступных тренировок. Загляните позже 🙌",
  "bot.slots.header": "Доступные тренировки:",
  "bot.slots.seats": "{count} мест",
  "bot.slots.freeLine": "Свободно: {seats} · {price} RSD",
  "bot.slots.book": "Записаться",
  "bot.slots.bookButton": "Записаться · {day} {time}",
  "bot.slots.notFound": "Эта тренировка больше недоступна. Выберите другую из списка.",
  "bot.slots.confirmTitle": "Подтвердите запись:",
  "bot.slots.confirmHint": "Нажмите «Подтвердить запись», чтобы записаться.",
  "bot.slots.confirmButton": "✅ Подтвердить запись",
  "bot.slots.bookedTitle": "✅ Вы записаны!",
  "bot.slots.bookedReminder": "Мы пришлём напоминание перед тренировкой.",
  "bot.slots.bookedShort": "✅ Вы записаны! Мы пришлём напоминание перед тренировкой.",
  "bot.slots.moreTrainings": "🏐 Еще тренировки",
  "bot.slots.full":
    "К сожалению, мест на эту тренировку уже нет 😔\n\nХотите записаться в лист ожидания? Мы сообщим, когда место освободится.",
  "bot.slots.joinWaitlist": "⏳ Встать в лист ожидания",
  "bot.slots.otherTrainings": "🏐 Другие тренировки",

  // --- My bookings (my-bookings.ts) ---
  "bot.myBookings.none": "У вас пока нет записей. Запишитесь на тренировку 🏐",
  "bot.myBookings.notOnboarded":
    "Чтобы видеть свои записи, сначала зарегистрируйтесь — нажмите /start.",
  "bot.myBookings.upcomingHeader": "Предстоящие тренировки:",
  "bot.myBookings.pastHeader": "Прошедшие тренировки:",
  "bot.myBookings.outcome.attended": "✅ посещено",
  "bot.myBookings.outcome.no_show": "🚫 не пришёл",
  "bot.myBookings.outcome.cancelled": "❌ отменено",
  "bot.myBookings.cancelButton": "❌ Отменить · {day} {time}",
  "bot.myBookings.cancelConfirm":
    "Вы уверены, что хотите отменить запись? Место снова станет доступным для других.",
  "bot.myBookings.cancelDone": "✅ Запись отменена.",
  "bot.myBookings.cancelConfirmButton": "✅ Да, отменить",
  "bot.myBookings.bookAgain": "🏐 Записаться снова",

  // --- Group booking (group-booking.ts) ---
  "bot.group.none": "Сейчас нет групп для записи. Загляните позже 🙌",
  "bot.group.header": "Группы для записи на месяц:",
  "bot.group.trainer": "Тренер: {name}",
  "bot.group.monthSubscription": "Абонемент на месяц: {price} RSD",
  "bot.group.pickButton": "👥 {name}",
  "bot.group.monthPickTitle": "Группа «{name}»",
  "bot.group.pickMonth": "Выберите месяц записи:",
  "bot.group.confirmTitle": "Запись в группу «{name}»",
  "bot.group.confirmMonth": "Месяц: {month}",
  "bot.group.confirmTotal": "Всего тренировок в месяце: {total}",
  "bot.group.confirmHint": "Нажмите «Подтвердить запись», чтобы записаться на весь месяц.",
  "bot.group.confirmButton": "✅ Подтвердить запись",
  "bot.group.successTitle": "✅ Вы записаны в группу на месяц!",
  "bot.group.successBooked": "Записано тренировок: {count}",
  "bot.group.successSkippedHeader": "Не удалось записать (нет мест):",
  "bot.group.successReminder": "Мы пришлём напоминание перед каждой тренировкой.",
  "bot.group.notFound": "Эта группа больше недоступна. Выберите другую из списка.",
  "bot.group.monthNotGenerated":
    "На выбранный месяц расписание ещё не сформировано 😔\n\nПопробуйте другой месяц или свяжитесь с менеджером.",

  // --- Waitlist (waitlist.ts) ---
  "bot.waitlist.joined":
    "✅ Вы в листе ожидания!\n\nКак только освободится место, мы пришлём уведомление с кнопкой подтверждения.",
  "bot.waitlist.joinConflict":
    "Не удалось записать в лист ожидания: место ещё доступно для обычной записи или вы уже в листе.",
  "bot.waitlist.acceptConflict":
    "К сожалению, место уже занято или время подтверждения истекло 😔\n\nЗагляните в доступные тренировки — возможно, есть другие места.",

  // --- Court rental (court.ts) ---
  "bot.court.open": "🏖 Аренда корта\n\nВыберите дату:",
  "bot.court.pickTime": "Выберите время начала:",
  "bot.court.pickDuration": "Выберите длительность:",
  "bot.court.noSlots": "На эту дату нет свободных кортов. Выберите другую дату.",
  "bot.court.submitted":
    "Заявка отправлена на подтверждение администратору. Ожидайте уведомления с номером корта.",
  "bot.court.durationHours": "{hours} ч",
  "bot.court.duration.1": "1 час",
  "bot.court.duration.1.5": "1.5 часа",
  "bot.court.duration.2": "2 часа",
  "bot.court.previewLine": "Дата: {date}, Время: {start}–{end} ({duration}). Итого: {price} RSD",
  "bot.court.previewUnavailable": "К сожалению, это время уже занято. Выберите другое.",
  "bot.court.send": "✅ Отправить заявку",

  // --- Court moderation (court-moderation.ts) ---
  "bot.courtMod.queueTitle": "🛠 Заявки на аренду корта",
  "bot.courtMod.empty": "Нет заявок, ожидающих подтверждения.",
  "bot.courtMod.notAdmin": "Раздел доступен только администратору.",
  "bot.courtMod.pick": "Выберите корт для назначения:",
  "bot.courtMod.noCourts": "Нет свободных кортов на это время. Заявку можно только отклонить.",
  "bot.courtMod.confirmed": "✅ Подтверждено. Клиент уведомлён.",
  "bot.courtMod.rejected": "🚫 Отклонено. Клиент уведомлён.",
  "bot.courtMod.queueLine": "{date} {start}–{end} ({duration}) · {price} RSD · {client}",
  "bot.courtMod.confirmButton": "✅ #{index} Подтвердить",
  "bot.courtMod.rejectButton": "🚫 Отклонить",
  "bot.courtMod.courtButton": "Корт №{number}",
  "bot.courtMod.backToRequests": "⬅️ К заявкам",

  // --- Court load grid (court-load.ts) ---
  "bot.courtLoad.title": "📊 Загрузка кортов",
  "bot.courtLoad.notAdmin": "Раздел доступен только администратору.",
  "bot.courtLoad.pickDate": "Выберите дату:",
  "bot.courtLoad.legend": "· свободно   R заявка   B блок   T тренировка",
  "bot.courtLoad.otherDate": "📅 Другая дата",

  // --- Trainer today (trainer-today.ts) ---
  "bot.trainer.notTrainer":
    "Этот раздел доступен только тренерам. Если вы тренер — обратитесь к менеджеру.",
  "bot.trainer.noToday": "На сегодня у вас нет тренировок 🙌",
  "bot.trainer.todayHeader": "Ваши тренировки сегодня:",
  "bot.trainer.emptyRoster": "На эту тренировку пока никто не записан.",
  "bot.trainer.attendance.attended": "✅ присутствовал",
  "bot.trainer.attendance.no_show": "❌ не пришёл",
  "bot.trainer.rosterButton": "📋 Список · {day} {time}",
  "bot.trainer.backToTrainings": "⬅️ К тренировкам",

  // --- Broadcasts (broadcast.ts) ---
  "bot.broadcast.notAdmin":
    "Этот раздел доступен только менеджеру. Если вы менеджер — обратитесь к администратору.",
  "bot.broadcast.menu": "Какую рассылку свободных мест подготовить?",
  "bot.broadcast.noSlots":
    "Свободных мест для этой рассылки сейчас нет. Выберите другой тип или загляните позже.",
  "bot.broadcast.type.today": "Сегодня",
  "bot.broadcast.type.tomorrow": "Завтра",
  "bot.broadcast.type.week": "На неделю",
  "bot.broadcast.type.freed-up": "Освободившиеся места",
  "bot.broadcast.audiencePrompt": "Кому отправить рассылку?",
  "bot.broadcast.pickLevel": "Выберите уровень для рассылки:",
  "bot.broadcast.audience.all": "Всем активным",
  "bot.broadcast.audience.level": "По уровню",
  "bot.broadcast.audience.active": "Активным (за {days} дн.)",
  "bot.broadcast.audience.lapsed": "Давно не были ({days} дн.)",
  "bot.broadcast.slotButton": "Записаться · {day} {time}",
  "bot.broadcast.send": "📨 Отправить",
  "bot.broadcast.changeAudience": "👥 Сменить аудиторию",
  "bot.broadcast.previewRecipients": "Получателей в сегменте: {count}",
  "bot.broadcast.previewHint": "Нажмите «Отправить», чтобы разослать.",
  "bot.broadcast.sent": "✅ Рассылка отправлена {count} получателям.",
  "bot.broadcast.another": "📨 Другая рассылка",

  // --- Stats / analytics summary (stats.ts) ---
  "bot.stats.title": "📊 Сводка по школе",
  "bot.stats.period": "Период: {from} — {to}",
  "bot.stats.totalBookings": "Всего записей: {count}",
  "bot.stats.fillRate": "Заполняемость: {percent}",
  "bot.stats.cancellations": "Отмены: {percent}",
  "bot.stats.noShows": "Неявки: {percent}",
  "bot.stats.activeClients": "Активных клиентов: {count}",
  "bot.stats.attributed": "Записей после рассылок: {count}",
  "bot.stats.topSlot": "Популярный слот: {day} {time} ({count})",
  "bot.stats.topSlotNone": "Популярный слот: —",

  // --- Manager console (manager-menu.ts) ---
  "bot.manager.menu": "Меню менеджера. Выберите действие:",
  "bot.manager.noTrainings":
    "В ближайшие 30 дней нет тренировок. Сгенерируйте расписание на месяц.",
  "bot.manager.overviewHeader": "Заполненность тренировок (30 дней):",
  "bot.manager.pickCancel": "Какую тренировку отменить?",
  "bot.manager.pickCap": "У какой тренировки изменить вместимость?",
  "bot.manager.cancelDone":
    "✅ Тренировка отменена. Записанные клиенты уведомлены, места освобождены.",
  "bot.manager.cancelAlready": "Эта тренировка уже отменена.",
  "bot.manager.cancelNotFound": "Тренировка не найдена.",
  "bot.manager.capDone": "✅ Вместимость обновлена.",
  "bot.manager.capBelowBooked":
    "Нельзя задать вместимость меньше числа уже записанных. Выберите большее значение.",
  "bot.manager.status.open": "открыта",
  "bot.manager.status.full": "заполнена",
  "bot.manager.status.cancelled": "отменена",
  "bot.manager.status.completed": "завершена",
  "bot.manager.btn.overview": "📊 Обзор заполненности",
  "bot.manager.btn.capacity": "🔢 Изменить вместимость",
  "bot.manager.btn.cancel": "🚫 Отменить тренировку",
  "bot.manager.btn.broadcasts": "📨 Рассылки",
  "bot.manager.btn.stats": "📈 Сводка по школе",
  "bot.manager.overviewLine": "{booked}/{capacity} · {status}",
  "bot.manager.cancelConfirmTitle": "Отменить тренировку {date}, {start}–{end}?",
  "bot.manager.cancelConfirmBody": "Записано: {booked}. Все записанные клиенты будут уведомлены.",
  "bot.manager.cancelConfirmButton": "✅ Да, отменить",
  "bot.manager.cancelButton": "🚫 {label}",
  "bot.manager.capButton": "🔢 {label}",
  "bot.manager.capPickTitle": "Тренировка {date}, {start}–{end}.",
  "bot.manager.capPickCurrent": "Сейчас: {booked}/{capacity}.",
  "bot.manager.capPickPrompt": "Выберите новую вместимость:",
  "bot.manager.capCurrentOption": "{count} (сейчас)",

  // --- Slot filters (slot-filters.ts) ---
  "bot.filter.timeOfDay.morning": "Утро",
  "bot.filter.timeOfDay.afternoon": "День",
  "bot.filter.timeOfDay.evening": "Вечер",
  "bot.filter.trainerFallback": "тренер",
  "bot.filter.levelFallback": "уровень",
  "bot.filter.active": "Фильтры: {filters}",
  "bot.filter.none": "Фильтры не выбраны",
  "bot.filter.chip.weekday": "День недели",
  "bot.filter.chip.time": "Время",
  "bot.filter.chip.trainer": "Тренер",
  "bot.filter.chip.level": "Уровень",
  "bot.filter.clear": "🧹 Сбросить фильтры",
  "bot.filter.anyWeekday": "Любой день",
  "bot.filter.anyTime": "Любое время",
  "bot.filter.anyTrainer": "Любой тренер",
  "bot.filter.anyLevel": "Любой уровень",
  "bot.filter.backToList": "⬅️ К списку",
  "bot.filter.pickWeekday": "Выберите день недели:",
  "bot.filter.pickTimeOfDay": "Выберите время дня:",
  "bot.filter.pickTrainer": "Выберите тренера:",
  "bot.filter.pickLevel": "Выберите уровень:"
};
