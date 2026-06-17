/**
 * RU miniapp-namespace strings (authoritative). All miniapp.* keys live here.
 *
 * The Mini App extraction agent ADDS miniapp.* keys to this file and mirrors the
 * SAME keys into ../sr/miniapp.ts and ../en/miniapp.ts (catalog-parity.spec
 * enforces the key sets stay identical). Do not put admin.* or bot.* keys here.
 *
 * `{param}` tokens are interpolated by the shared resolver `t()`; keep them
 * identical across locales. No money or availability math lives in these strings.
 */
export const miniappRu: Record<string, string> = {
  // --- Onboarding wizard ---
  "miniapp.onboarding.step": "Шаг {n} из 3",
  "miniapp.onboarding.nameHeader": "Как вас зовут?",
  "miniapp.onboarding.nameHint": "Под этим именем вас увидит тренер.",
  "miniapp.onboarding.namePlaceholder": "Ваше имя",
  "miniapp.onboarding.langHeader": "Язык",
  "miniapp.onboarding.levelHeader": "Ваш уровень",
  "miniapp.onboarding.levelFooter": "Можно выбрать позже",
  "miniapp.onboarding.levelSkip": "Пока не знаю",

  // --- Primary actions ---
  "miniapp.action.continue": "Продолжить",
  "miniapp.action.done": "Готово",

  // --- Home menu & navigation shell (S2) ---
  "miniapp.home.title": "BeoSand",
  "miniapp.home.subtitle": "Школа пляжного волейбола · Белград",
  "miniapp.home.sectionTrainings": "Тренировки",
  "miniapp.home.sectionCourts": "Корты",
  "miniapp.home.sectionAccount": "Профиль",
  "miniapp.home.myBookings": "Мои записи",
  "miniapp.home.myBookingsHint": "Предстоящие и прошедшие",
  "miniapp.home.group": "Купить абонемент (группа)",
  "miniapp.home.groupHint": "Месячная подписка на группу",
  "miniapp.home.individual": "Индивидуальная тренировка",
  "miniapp.home.individualHint": "Запрос тренеру один на один",
  "miniapp.home.schedule": "Расписание тренировок",
  "miniapp.home.scheduleHint": "Календарь занятий по месяцам — выберите день",
  "miniapp.home.court": "Аренда корта",
  "miniapp.home.courtHint": "Заявка на свободный корт",
  "miniapp.home.calendar": "Мой календарь",
  "miniapp.home.calendarHint": "Записи и заявки на корт по дням",
  "miniapp.home.profile": "Профиль и язык",
  "miniapp.home.profileHint": "Ваши данные и язык интерфейса",
  "miniapp.home.placeholderTitle": "Скоро",
  "miniapp.home.placeholderBody": "Этот раздел появится в ближайшем обновлении.",

  // --- Profile ---
  "miniapp.profile.title": "Профиль",
  "miniapp.profile.settings": "Настройки",
  "miniapp.profile.level": "Уровень",
  "miniapp.profile.levelNone": "Не указан",
  "miniapp.profile.language": "Язык интерфейса",

  // --- Common states ---
  "miniapp.common.loading": "Загрузка…",
  "miniapp.common.error": "Что-то пошло не так",
  "miniapp.common.errorBody": "Не удалось выполнить запрос. Попробуйте ещё раз.",
  "miniapp.common.notTelegram": "Откройте это приложение из Telegram, чтобы продолжить.",
  "miniapp.common.authPending": "Авторизация…",
  "miniapp.common.authError": "Не удалось авторизоваться",

  // --- Weekday names (1 = Пн … 7 = Вс) ---
  "miniapp.weekday.short.1": "Пн",
  "miniapp.weekday.short.2": "Вт",
  "miniapp.weekday.short.3": "Ср",
  "miniapp.weekday.short.4": "Чт",
  "miniapp.weekday.short.5": "Пт",
  "miniapp.weekday.short.6": "Сб",
  "miniapp.weekday.short.7": "Вс",
  "miniapp.weekday.full.1": "Понедельник",
  "miniapp.weekday.full.2": "Вторник",
  "miniapp.weekday.full.3": "Среда",
  "miniapp.weekday.full.4": "Четверг",
  "miniapp.weekday.full.5": "Пятница",
  "miniapp.weekday.full.6": "Суббота",
  "miniapp.weekday.full.7": "Воскресенье",

  // --- Time-of-day bands ---
  "miniapp.timeOfDay.morning": "Утро",
  "miniapp.timeOfDay.afternoon": "День",
  "miniapp.timeOfDay.evening": "Вечер",

  // --- Slot card labels (shared by the schedule day-detail + confirm/waitlist views) ---
  "miniapp.browse.seats": "{count} мест",
  "miniapp.browse.seatsNone": "Нет мест",
  "miniapp.browse.price": "{price} RSD",
  "miniapp.browse.bookAria": "Записаться",
  "miniapp.browse.waitlist": "Лист ожидания",
  "miniapp.browse.waitlistAria": "Встать в лист ожидания",

  // --- Filter sheet labels (shared by the group-list filter) ---
  "miniapp.browse.filter.any": "Любой",
  "miniapp.browse.filter.weekday": "День недели",
  "miniapp.browse.filter.trainer": "Тренер",
  "miniapp.browse.filter.level": "Уровень",
  "miniapp.browse.filter.apply": "Применить",
  "miniapp.browse.filter.reset": "Сбросить",

  // --- Single booking confirm (S4) ---
  "miniapp.booking.confirm": "Записаться",
  "miniapp.booking.confirmHeader": "Подтверждение записи",
  "miniapp.booking.dateLabel": "Дата",
  "miniapp.booking.timeLabel": "Время",
  "miniapp.booking.trainerLabel": "Тренер",
  "miniapp.booking.levelLabel": "Уровень",
  "miniapp.booking.seatsLabel": "Свободно мест",
  "miniapp.booking.priceLabel": "Стоимость",
  "miniapp.booking.successTitle": "Вы записаны!",
  // Shown when the booking comes back `pending`: the trainer must confirm the request.
  "miniapp.booking.pendingTitle": "Заявка отправлена",
  "miniapp.booking.pendingBody": "Ожидает подтверждения тренера.",
  "miniapp.booking.backToList": "К расписанию",
  "miniapp.booking.conflict": "Это место только что заняли. Выберите другую тренировку.",

  // --- Waitlist (S6): join + accept ---
  // Join confirm (shared by the Browse full-slot tap and the booking-409 offer).
  "miniapp.waitlist.joinConfirm": "Встать в лист ожидания",
  "miniapp.waitlist.joinConfirmHeader": "Лист ожидания",
  "miniapp.waitlist.joinConfirmBody":
    "Это место занято. Встаньте в лист ожидания — мы пришлём уведомление, когда оно освободится.",
  // The secondary offer shown alongside a booking 409 ("slot filled meanwhile").
  "miniapp.waitlist.joinOfferTitle": "Место только что заняли",
  // Joined-success state.
  "miniapp.waitlist.joinedTitle": "Вы в листе ожидания",
  "miniapp.waitlist.joinedBody": "Мы уведомим вас, когда место освободится.",
  "miniapp.waitlist.positionLabel": "Ваша позиция: {position}",
  // Join conflict fallback (used only when a ConflictError carries no message).
  "miniapp.waitlist.joinConflict":
    "Не удалось встать в лист ожидания. Возможно, вы уже в нём или место снова доступно.",
  // Accept screen (deep link startapp=waitlist_<id>).
  "miniapp.waitlist.acceptHeader": "Освободилось место",
  "miniapp.waitlist.acceptBody": "Подтвердите запись, пока место свободно.",
  "miniapp.waitlist.accept": "Подтвердить",
  "miniapp.waitlist.acceptedTitle": "Вы записаны!",
  "miniapp.waitlist.acceptedBody": "Место за вами. Детали — в разделе «Мои записи».",
  // Accept conflict (window closed / seat re-taken); server message shown verbatim,
  // these are the calm framing + fallback when the ConflictError has no message.
  "miniapp.waitlist.expiredTitle": "Окно подтверждения закрылось",
  "miniapp.waitlist.expiredBody": "Место уже занято или время на подтверждение истекло.",
  // Navigation out of a waitlist state.
  "miniapp.waitlist.toSchedule": "К расписанию",
  "miniapp.waitlist.toMyBookings": "К моим записям",
  "miniapp.waitlist.toHome": "На главную",

  // --- Group monthly subscription (S7) ---
  "miniapp.group.listTitle": "Группы",
  "miniapp.group.none": "Нет доступных групп",
  "miniapp.group.noneBody": "Пока нет групп для записи. Загляните позже.",
  // The monthly-subscription price chip + label ({price} is RSD from the server).
  "miniapp.group.monthSubscription": "{price} RSD / месяц",
  "miniapp.group.openAria": "Открыть группу",
  // Group detail facts.
  "miniapp.group.daysLabel": "Дни",
  "miniapp.group.priceLabel": "Стоимость",
  // Month picker (exactly two options: текущий и следующий месяц).
  "miniapp.group.pickMonth": "Выберите месяц",
  // Confirm + result.
  "miniapp.group.confirm": "Записаться на месяц",
  "miniapp.group.back": "Назад",
  "miniapp.group.groupLabel": "Группа",
  "miniapp.group.monthLabel": "Месяц",
  "miniapp.group.confirmBody":
    "Подписка на группу «{name}» на {month}. С вас спишут {price} RSD за месяц.",
  "miniapp.group.resultTitle": "Готово!",
  "miniapp.group.createdCount": "Вы записаны на {count} тренировок",
  // Shown when the month's bookings come back `pending`: the trainer must confirm them.
  "miniapp.group.pendingTitle": "Заявка отправлена",
  "miniapp.group.pendingCount": "Ожидает подтверждения по {count} тренировкам",
  "miniapp.group.skippedHeader": "Пропущенные даты (нет мест)",
  "miniapp.group.toMyBookings": "К моим записям",
  "miniapp.group.toHome": "На главную",
  // Roster block ("who signed up") on the group detail / month preview.
  "miniapp.group.roster.title": "Кто записан",
  "miniapp.group.roster.empty": "Пока никто не записан",
  // Group-list filter (level / trainer / weekday).
  "miniapp.group.filtersAria": "Фильтры групп",
  "miniapp.group.filter.title": "Фильтры",
  "miniapp.group.filterEmpty": "Нет подходящих групп",
  "miniapp.group.filterEmptyBody": "Измените фильтры, чтобы увидеть другие группы.",
  // Conflict fallback (used only when a ConflictError carries no message).
  "miniapp.group.conflict":
    "Не удалось оформить подписку. Возможно, группа недоступна или месяц закрыт.",

  // --- Individual training request (S8) ---
  // Trainer list.
  "miniapp.individual.listTitle": "Выберите тренера",
  "miniapp.individual.none": "Нет доступных тренеров",
  "miniapp.individual.noneBody": "Пока некого выбрать. Загляните позже.",
  // Neutral trainer-type label (main/guest) — never the trainer's contact details.
  "miniapp.individual.typeMain": "Основной тренер",
  "miniapp.individual.typeGuest": "Приглашённый тренер",
  // Confirm-row label for the type field.
  "miniapp.individual.typeLabel": "Тренер",
  // List-row accessible action ("открыть, чтобы запросить тренировку").
  "miniapp.individual.openAria": "Запросить тренировку",
  // Confirm sub-state.
  "miniapp.individual.confirmTitle": "Индивидуальная тренировка",
  "miniapp.individual.confirmBody":
    "Мы отправим тренеру «{name}» запрос на индивидуальную тренировку. Тренер свяжется с вами, чтобы согласовать время.",
  "miniapp.individual.request": "Запросить тренировку",
  // Delivered-success state.
  "miniapp.individual.sentTitle": "Запрос отправлен",
  "miniapp.individual.sentBody": "Тренер получил ваш запрос и свяжется с вами.",
  "miniapp.individual.toHome": "На главную",
  // Calm soft state when the trainer is unreachable (a 200 delivered:false — NOT an error).
  "miniapp.individual.unavailableTitle": "Тренер сейчас недоступен",
  "miniapp.individual.unavailableBody": "Пока не получилось связаться. Попробуйте выбрать другого тренера.",
  "miniapp.individual.pickAnother": "Выбрать другого",

  // --- Court rental request (S9) ---
  // Step 1 — pick a date.
  "miniapp.court.pickDate": "Выберите дату",
  // Step 2 — pick a start time. The count is free courts, NEVER a court number.
  "miniapp.court.pickTime": "Выберите время",
  "miniapp.court.freeCount": "{count} свободно",
  "miniapp.court.noTimesTitle": "Нет свободного времени",
  "miniapp.court.noTimesBody": "На этот день нет свободных кортов. Выберите другую дату.",
  // Step 3 — pick a duration (1…6 ч, шаг 0,5). The {hours} token is a comma-decimal.
  "miniapp.court.pickDuration": "Длительность",
  "miniapp.court.durationHours": "{hours} ч",
  "miniapp.court.durationLabel": "Длительность",
  // Step 4 — pick one or more specific courts (the server returns the free ones).
  "miniapp.court.pickCourts": "Выберите корт(ы)",
  "miniapp.court.pickCourtsHint": "Можно выбрать несколько свободных кортов.",
  "miniapp.court.courtN": "Корт {n}",
  "miniapp.court.courtTaken": "Корт {n} занят",
  "miniapp.court.noCourtsTitle": "Нет свободных кортов",
  "miniapp.court.noCourtsBody": "На это время не осталось свободных кортов. Выберите другое время.",
  "miniapp.court.selectedCount": "Выбрано кортов: {count}",
  "miniapp.court.continue": "Продолжить",
  "miniapp.court.courtsLabel": "Корты",
  // Step 5 — price preview ({price} is RSD from the server, for the picked courts).
  "miniapp.court.previewTitle": "Подтверждение заявки",
  "miniapp.court.previewBody": "Выбранные корты закреплены за вами до подтверждения администратором.",
  "miniapp.court.submit": "Отправить заявку",
  // Step 6 — pending. The picked courts ARE shown now (owner-approved).
  "miniapp.court.sentTitle": "Запрос отправлен",
  "miniapp.court.sentBody": "Мы подтвердим выбранные корты и сообщим вам.",
  "miniapp.court.sentCourts": "Выбранные корты: {courts}",
  "miniapp.court.toHome": "На главную",
  // Calm "slot taken meanwhile" state (preview unavailable or a submit 409) — NOT an error.
  "miniapp.court.unavailableTitle": "Это время заняли",
  "miniapp.court.unavailableBody": "Это время только что заняли. Выберите другое.",
  "miniapp.court.pickAnotherTime": "Выбрать другое время",
  // Conflict fallback (used only when a ConflictError carries no message).
  "miniapp.court.conflict": "Не удалось отправить заявку. Возможно, это время уже заняли.",

  // --- Month names (1 = Январь … 12 = Декабрь) ---
  "miniapp.month.1": "Январь",
  "miniapp.month.2": "Февраль",
  "miniapp.month.3": "Март",
  "miniapp.month.4": "Апрель",
  "miniapp.month.5": "Май",
  "miniapp.month.6": "Июнь",
  "miniapp.month.7": "Июль",
  "miniapp.month.8": "Август",
  "miniapp.month.9": "Сентябрь",
  "miniapp.month.10": "Октябрь",
  "miniapp.month.11": "Ноябрь",
  "miniapp.month.12": "Декабрь",

  // --- My bookings + cancel (S5) ---
  "miniapp.myBookings.title": "Мои записи",
  // Segmented Upcoming|Past control.
  "miniapp.myBookings.tabUpcoming": "Предстоящие",
  "miniapp.myBookings.tabPast": "Прошедшие",
  "miniapp.myBookings.tabsAria": "Предстоящие и прошедшие записи",
  // Per-scope empty states (distinct from loading and error).
  "miniapp.myBookings.emptyUpcomingTitle": "Нет предстоящих записей",
  "miniapp.myBookings.emptyUpcomingBody": "Выберите тренировку в расписании и запишитесь.",
  "miniapp.myBookings.emptyPastTitle": "Нет прошедших записей",
  "miniapp.myBookings.emptyPastBody": "Здесь появятся ваши завершённые тренировки.",
  // A path from the empty Upcoming state to Browse.
  "miniapp.myBookings.toBrowse": "К расписанию",
  // Status / outcome chips. Upcoming items show "booked"; past items show the outcome.
  "miniapp.myBookings.status.booked": "Запись",
  "miniapp.myBookings.status.pending": "Ожидает подтверждения",
  "miniapp.myBookings.status.attended": "Посещено",
  "miniapp.myBookings.status.noShow": "Пропуск",
  "miniapp.myBookings.status.cancelled": "Отменено",
  // The Cancel affordance (shown only when the server says canCancel).
  "miniapp.myBookings.cancelAria": "Отменить запись",
  // Cancel confirm step (bottom-sheet) + warning haptic.
  "miniapp.myBookings.cancelConfirmTitle": "Отменить запись?",
  "miniapp.myBookings.cancelConfirmBody":
    "Запись на эту тренировку будет отменена. Это действие нельзя отменить.",
  "miniapp.myBookings.cancelConfirm": "Отменить запись",
  "miniapp.myBookings.cancelKeep": "Оставить",
  // Success + conflict.
  "miniapp.myBookings.cancelledTitle": "Запись отменена",
  "miniapp.myBookings.cancelledBody": "Место снова свободно для других.",
  "miniapp.myBookings.cancelConflict":
    "Не удалось отменить запись. Возможно, она уже отменена или больше недоступна для отмены.",
  // Error loading the list.
  "miniapp.myBookings.errorBody": "Не удалось загрузить ваши записи. Попробуйте ещё раз.",

  // --- Training schedule (расписание): month calendar of bookable sessions ---
  "miniapp.schedule.title": "Расписание тренировок",
  "miniapp.schedule.hint": "Выберите день, чтобы увидеть тренировки и записаться.",
  "miniapp.schedule.navAria": "Переключение месяца",
  "miniapp.schedule.prevMonth": "Предыдущий месяц",
  "miniapp.schedule.nextMonth": "Следующий месяц",
  "miniapp.schedule.gridAria": "Календарь тренировок на {month}",
  "miniapp.schedule.dayAria": "{day} число, тренировок: {count}",
  "miniapp.schedule.emptyDayTitle": "Нет тренировок в этот день",
  "miniapp.schedule.emptyDayBody": "Выберите другой день в календаре.",
  "miniapp.schedule.errorBody": "Не удалось загрузить расписание. Попробуйте ещё раз.",

  // --- My calendar (court + training) ---
  "miniapp.calendar.title": "Мой календарь",
  "miniapp.calendar.navAria": "Переключение месяца",
  "miniapp.calendar.prevMonth": "Предыдущий месяц",
  "miniapp.calendar.nextMonth": "Следующий месяц",
  "miniapp.calendar.gridAria": "Календарь на {month}",
  "miniapp.calendar.dayAria": "{day} число, событий: {count}",
  "miniapp.calendar.agendaAria": "События выбранного дня",
  "miniapp.calendar.emptyDay": "В этот день нет записей и заявок.",
  "miniapp.calendar.kindTraining": "Тренировка",
  "miniapp.calendar.kindCourt": "Корт",
  "miniapp.calendar.kindAvailable": "Доступно",
  "miniapp.calendar.legendAria": "Обозначения календаря",
  "miniapp.calendar.errorBody": "Не удалось загрузить календарь. Попробуйте ещё раз.",
  // Court-request status chips (a client never sees a court number).
  "miniapp.calendar.courtStatus.pending": "Ожидает подтверждения",
  "miniapp.calendar.courtStatus.confirmed": "Подтверждено",
  "miniapp.calendar.courtStatus.rejected": "Отклонено",
  "miniapp.calendar.courtStatus.cancelled": "Отменено"
};
