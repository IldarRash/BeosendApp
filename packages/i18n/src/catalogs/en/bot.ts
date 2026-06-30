/**
 * EN bot-namespace strings. Translated from the authoritative RU catalog; needs
 * native review. Mirrors every RU bot.* key; missing keys fall back to RU at
 * resolve time.
 */
export const botEn: Record<string, string> = {
  // --- Proof-of-shape keys (seeded by the foundation) ---
  "bot.menu.welcome": "Welcome to BeoSand!",
  "bot.menu.back": "Back",
  "bot.action.confirm": "Confirm",

  // --- Notification inline-button labels (sent from apps/api, resolved per recipient locale) ---
  "bot.notify.confirm": "✅ Confirm",
  "bot.notify.decline": "❌ Decline",
  "bot.notify.openAdmin": "Open in admin",
  "bot.notify.openRequest": "Open request",
  "bot.notify.bookSlot": "Sign up · {time} · {level}",

  // --- Main menu (menu.ts) ---
  "bot.menu.welcomeFull":
    "Welcome to BeoSand 🏐\n\nHere you can:\n• book a training session\n• view free slots\n• see your bookings",
  "bot.menu.openApp": "🚀 Open the app",
  "bot.menu.availableTrainings": "🎫 Single visit",
  "bot.menu.todayFreeSlots": "📅 Free slots today",
  "bot.menu.joinGroup": "👥 Join a group",
  "bot.menu.individual": "🧑‍🏫 Individual training",
  "bot.menu.myBookings": "📋 My bookings",
  "bot.menu.rentCourt": "🏖 Rent a court",
  "bot.menu.contactManager": "ℹ️ Contact the manager",
  "bot.menu.language": "🌐 Language / Язык",
  "bot.menu.contactManagerLine": "Contact the manager: {contact}",
  "bot.menu.contactManagerButton": "✉️ Message the manager",

  // --- Free spots today (navigation.ts, Feature 6) ---
  "bot.today.header": "Free spots today:",
  "bot.today.none": "No free spots for today. Check back later 🙌",

  // --- Individual training (individual.ts, Feature 8) ---
  "bot.individual.pickTrainer": "Which coach would you like?",
  "bot.individual.noTrainers": "No coaches are available right now. Check back later 🙌",
  "bot.individual.requested": "✅ Your request was sent to the coach. They will contact you on Telegram.",
  "bot.individual.trainerUnavailable":
    "This coach is not available on Telegram yet. Choose another or contact the manager.",
  "bot.individual.pickButton": "🧑‍🏫 {name}",

  // --- Shared navigation (menu.ts) ---
  "bot.nav.back": "⬅️ Back",
  "bot.nav.home": "🏠 Main menu",
  "bot.nav.toMenu": "⬅️ To menu",
  "bot.nav.menuShort": "🏠 Menu",

  // --- Language switch (menu.ts / index.ts) ---
  "bot.language.prompt": "Choose your language / Выберите язык:",
  "bot.language.changed": "Language changed. Current language: {language}.",

  // --- Onboarding (onboarding.ts) ---
  "bot.onboarding.welcome":
    "Welcome to BeoSand 🏐\n\nLet's get acquainted. What is your name?",
  "bot.onboarding.askLevel": "What is your playing level?",
  "bot.onboarding.askLanguage": "Which language is more comfortable for you? / Choose your language:",
  "bot.onboarding.levelNone": "🤷 I don't know",

  // --- Weekday short labels (shared by several screens) ---
  "bot.weekday.short.1": "Mon",
  "bot.weekday.short.2": "Tue",
  "bot.weekday.short.3": "Wed",
  "bot.weekday.short.4": "Thu",
  "bot.weekday.short.5": "Fri",
  "bot.weekday.short.6": "Sat",
  "bot.weekday.short.7": "Sun",
  // --- Weekday full labels (stats) ---
  "bot.weekday.full.1": "Monday",
  "bot.weekday.full.2": "Tuesday",
  "bot.weekday.full.3": "Wednesday",
  "bot.weekday.full.4": "Thursday",
  "bot.weekday.full.5": "Friday",
  "bot.weekday.full.6": "Saturday",
  "bot.weekday.full.7": "Sunday",
  // --- Month names (group booking) ---
  "bot.month.1": "January",
  "bot.month.2": "February",
  "bot.month.3": "March",
  "bot.month.4": "April",
  "bot.month.5": "May",
  "bot.month.6": "June",
  "bot.month.7": "July",
  "bot.month.8": "August",
  "bot.month.9": "September",
  "bot.month.10": "October",
  "bot.month.11": "November",
  "bot.month.12": "December",

  // --- Available slots (slots.ts) ---
  "bot.slots.none": "There are no available trainings right now. Check back later 🙌",
  "bot.slots.header": "Available trainings:",
  "bot.slots.seats": "{count} seats",
  "bot.slots.freeLine": "Free: {seats} · {price} RSD",
  "bot.slots.book": "Book",
  "bot.slots.bookButton": "Book · {day} {time}",
  "bot.slots.notFound": "This training is no longer available. Choose another one from the list.",
  "bot.slots.confirmTitle": "Confirm your booking:",
  "bot.slots.confirmHint": "Tap “Confirm booking” to book.",
  "bot.slots.confirmButton": "✅ Confirm booking",
  "bot.slots.bookedTitle": "✅ You're booked!",
  "bot.slots.bookedReminder": "We'll send a reminder before the training.",
  "bot.slots.bookedShort": "✅ You're booked! We'll send a reminder before the training.",
  "bot.slots.moreTrainings": "🏐 More trainings",
  "bot.slots.otherTrainings": "🏐 Other trainings",

  // --- My bookings (my-bookings.ts) ---
  "bot.myBookings.none": "You don't have any bookings yet. Book a training 🏐",
  "bot.myBookings.notOnboarded":
    "To see your bookings, please register first — tap /start.",
  "bot.myBookings.upcomingHeader": "Upcoming trainings:",
  "bot.myBookings.pastHeader": "Past trainings:",
  "bot.myBookings.outcome.attended": "✅ attended",
  "bot.myBookings.outcome.no_show": "🚫 no-show",
  "bot.myBookings.outcome.cancelled": "❌ cancelled",
  "bot.myBookings.cancelButton": "❌ Cancel · {date} {time}",
  "bot.myBookings.cancelConfirm":
    "Are you sure you want to cancel the booking? The seat will become available to others again.",
  "bot.myBookings.cancelDone": "✅ Booking cancelled.",
  "bot.myBookings.cancelConfirmButton": "✅ Yes, cancel",
  "bot.myBookings.bookAgain": "🏐 Book again",

  // --- Group booking (group-booking.ts) ---
  "bot.group.none": "There are no groups to join right now. Check back later 🙌",
  "bot.group.header": "Groups for monthly booking:",
  "bot.group.trainer": "Coach: {name}",
  "bot.group.monthSubscription": "Monthly subscription: {price} RSD",
  "bot.group.pickButton": "👥 {name}",
  "bot.group.monthPickTitle": "Group “{name}”",
  "bot.group.pickMonth": "Choose the booking month:",
  "bot.group.confirmTitle": "Joining group “{name}”",
  "bot.group.confirmMonth": "Month: {month}",
  "bot.group.confirmTotal": "Total trainings this month: {total}",
  "bot.group.confirmHint": "Tap “Confirm booking” to book for the whole month.",
  "bot.group.confirmButton": "✅ Confirm booking",
  "bot.group.successTitle": "✅ You're booked into the group for the month!",
  "bot.group.successBooked": "Trainings booked: {count}",
  "bot.group.successWaitlisted":
    "You're on the waitlist for {count} day(s) — we'll let you know as soon as a seat frees up.",
  "bot.group.successBonus": "Bonus trainings granted: {count}.",
  "bot.group.successSkippedHeader": "Couldn't book (no seats):",
  "bot.group.successReminder": "We'll send a reminder before each training.",
  "bot.group.notFound": "This group is no longer available. Choose another one from the list.",
  "bot.group.monthNotGenerated":
    "The schedule for the selected month hasn't been generated yet 😔\n\nTry another month or contact the manager.",

  // --- Waitlist (booking.ts auto-join on a full slot) ---
  "bot.waitlist.autoJoined":
    "There are no more seats for this training 😔\n\nYou're automatically on the waitlist, position {position}. As soon as a seat opens up, we'll book you in and send a notification.",
  "bot.waitlist.joinConflict":
    "Couldn't add you to the waitlist: the seat is still available for a regular booking, or you're already on the list.",

  // --- Court rental (court.ts) ---
  "bot.court.open": "🏖 Court rental\n\nChoose a date:",
  "bot.court.pickTime": "Choose a start time:",
  "bot.court.pickDuration": "Choose a duration:",
  "bot.court.noSlots": "There are no free courts for this date. Choose another date.",
  "bot.court.submitted":
    "Your request has been sent to the administrator for confirmation. Wait for a notification with the court number.",
  "bot.court.durationHours": "{hours} h",
  "bot.court.duration.1": "1 hour",
  "bot.court.duration.1.5": "1.5 hours",
  "bot.court.duration.2": "2 hours",
  "bot.court.previewLine": "Date: {date}, Time: {start}–{end} ({duration}). Total: {price} RSD",
  "bot.court.previewUnavailable": "Unfortunately, this time is already taken. Choose another.",
  "bot.court.send": "✅ Send request",

  // --- Court moderation (court-moderation.ts) ---
  "bot.courtMod.queueTitle": "🛠 Court rental requests",
  "bot.courtMod.empty": "No requests awaiting confirmation.",
  "bot.courtMod.notAdmin": "This section is available to the administrator only.",
  "bot.courtMod.pick": "Choose a court to assign:",
  "bot.courtMod.noCourts": "No free courts for this time. The request can only be rejected.",
  "bot.courtMod.confirmed": "✅ Confirmed. The client has been notified.",
  "bot.courtMod.rejected": "🚫 Rejected. The client has been notified.",
  "bot.courtMod.queueLine": "{date} {start}–{end} ({duration}) · {price} RSD · {client}",
  "bot.courtMod.confirmButton": "✅ #{index} Confirm",
  "bot.courtMod.rejectButton": "🚫 Reject",
  "bot.courtMod.courtButton": "Court #{number}",
  "bot.courtMod.backToRequests": "⬅️ To requests",

  // --- Court load grid (court-load.ts) ---
  "bot.courtLoad.title": "📊 Court load",
  "bot.courtLoad.notAdmin": "This section is available to the administrator only.",
  "bot.courtLoad.pickDate": "Choose a date:",
  "bot.courtLoad.legend": "· free   R request   B block   T training",
  "bot.courtLoad.otherDate": "📅 Another date",

  // --- Trainer today (trainer-today.ts) ---
  "bot.trainer.notTrainer":
    "This section is available to coaches only. If you're a coach — contact the manager.",
  "bot.trainer.noToday": "You have no trainings today 🙌",
  "bot.trainer.todayHeader": "Your trainings today:",
  "bot.trainer.emptyRoster": "No one has booked this training yet.",
  "bot.trainer.attendance.attended": "✅ attended",
  "bot.trainer.attendance.no_show": "❌ no-show",
  "bot.trainer.rosterButton": "📋 Roster · {day} {time}",
  "bot.trainer.backToTrainings": "⬅️ To trainings",
  "bot.trainer.upcomingHeader": "Your upcoming trainings:",
  "bot.trainer.noUpcoming": "You have no upcoming trainings 🙌",

  // --- Trainer confirmation (trainer-confirm.ts) ---
  "bot.trainerConfirm.confirmed": "✅ Booking confirmed.",
  "bot.trainerConfirm.declined": "❌ Booking declined.",
  "bot.trainerConfirm.alreadyDecided": "This request has already been handled.",
  "bot.trainerConfirm.notAuthorized": "You don't have permission for this action.",

  // --- Broadcasts (broadcast.ts) ---
  "bot.broadcast.notAdmin":
    "This section is available to the manager only. If you're a manager — contact the administrator.",
  "bot.broadcast.menu": "Which free-slot broadcast would you like to prepare?",
  "bot.broadcast.noSlots":
    "There are no free slots for this broadcast right now. Choose another type or check back later.",
  "bot.broadcast.type.today": "Today",
  "bot.broadcast.type.tomorrow": "Tomorrow",
  "bot.broadcast.type.week": "This week",
  "bot.broadcast.type.freed-up": "Freed-up slots",
  "bot.broadcast.audiencePrompt": "Who should receive the broadcast?",
  "bot.broadcast.pickLevel": "Choose a level for the broadcast:",
  "bot.broadcast.audience.all": "All active",
  "bot.broadcast.audience.level": "By level",
  "bot.broadcast.audience.active": "Active (last {days} days)",
  "bot.broadcast.audience.lapsed": "Long inactive ({days} days)",
  "bot.broadcast.slotButton": "Book · {day} {time}",
  "bot.broadcast.send": "📨 Send",
  "bot.broadcast.changeAudience": "👥 Change audience",
  "bot.broadcast.previewRecipients": "Recipients in the segment: {count}",
  "bot.broadcast.previewHint": "Tap “Send” to broadcast.",
  "bot.broadcast.sent": "✅ Broadcast sent to {count} recipients.",
  "bot.broadcast.another": "📨 Another broadcast",

  // --- Stats / analytics summary (stats.ts) ---
  "bot.stats.title": "📊 School summary",
  "bot.stats.period": "Period: {from} — {to}",
  "bot.stats.totalBookings": "Total bookings: {count}",
  "bot.stats.fillRate": "Fill rate: {percent}",
  "bot.stats.cancellations": "Cancellations: {percent}",
  "bot.stats.noShows": "No-shows: {percent}",
  "bot.stats.activeClients": "Active clients: {count}",
  "bot.stats.attributed": "Bookings after broadcasts: {count}",
  "bot.stats.topSlot": "Popular slot: {day} {time} ({count})",
  "bot.stats.topSlotNone": "Popular slot: —",

  // --- Manager console (manager-menu.ts) ---
  "bot.manager.menu": "Manager menu. Choose an action:",
  "bot.manager.noTrainings":
    "There are no trainings in the next 30 days. Generate a monthly schedule.",
  "bot.manager.overviewHeader": "Training fill rate (30 days):",
  "bot.manager.pickCancel": "Which training do you want to delete?",
  "bot.manager.pickCap": "For which training do you want to change the capacity?",
  "bot.manager.cancelDone":
    "✅ Training deleted. Booked clients have been notified, seats freed.",
  "bot.manager.cancelNotFound": "Training not found.",
  "bot.manager.capDone": "✅ Capacity updated.",
  "bot.manager.capBelowBooked":
    "You can't set a capacity lower than the number already booked. Choose a higher value.",
  "bot.manager.status.open": "open",
  "bot.manager.status.full": "full",
  "bot.manager.status.cancelled": "cancelled",
  "bot.manager.status.completed": "completed",
  "bot.manager.btn.overview": "📊 Fill-rate overview",
  "bot.manager.btn.capacity": "🔢 Change capacity",
  "bot.manager.btn.cancel": "🗑 Delete training",
  "bot.manager.btn.broadcasts": "📨 Broadcasts",
  "bot.manager.btn.stats": "📈 School summary",
  "bot.manager.overviewLine": "{booked}/{capacity} · {status}",
  "bot.manager.cancelConfirmTitle": "Delete training {date}, {start}–{end}?",
  "bot.manager.cancelConfirmBody":
    "Booked: {booked}. The training will be permanently deleted and all booked clients will be notified.",
  "bot.manager.cancelConfirmButton": "✅ Yes, delete",
  "bot.manager.cancelButton": "🚫 {label}",
  "bot.manager.capButton": "🔢 {label}",
  "bot.manager.capPickTitle": "Training {date}, {start}–{end}.",
  "bot.manager.capPickCurrent": "Now: {booked}/{capacity}.",
  "bot.manager.capPickPrompt": "Choose a new capacity:",
  "bot.manager.capCurrentOption": "{count} (current)",

  // --- Slot filters (slot-filters.ts) ---
  "bot.filter.timeOfDay.morning": "Morning",
  "bot.filter.timeOfDay.afternoon": "Afternoon",
  "bot.filter.timeOfDay.evening": "Evening",
  "bot.filter.trainerFallback": "coach",
  "bot.filter.levelFallback": "level",
  "bot.filter.active": "Filters: {filters}",
  "bot.filter.none": "No filters selected",
  "bot.filter.chip.weekday": "Weekday",
  "bot.filter.chip.time": "Time",
  "bot.filter.chip.trainer": "Coach",
  "bot.filter.chip.level": "Level",
  "bot.filter.clear": "🧹 Clear filters",
  "bot.filter.anyWeekday": "Any day",
  "bot.filter.anyTime": "Any time",
  "bot.filter.anyTrainer": "Any coach",
  "bot.filter.anyLevel": "Any level",
  "bot.filter.backToList": "⬅️ To list",
  "bot.filter.pickWeekday": "Choose a weekday:",
  "bot.filter.pickTimeOfDay": "Choose a time of day:",
  "bot.filter.pickTrainer": "Choose a coach:",
  "bot.filter.pickLevel": "Choose a level:"
};
