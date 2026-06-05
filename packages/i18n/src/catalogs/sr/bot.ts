/**
 * SR bot-namespace strings (Serbian, Latin). Translated from the authoritative
 * RU catalog; needs native review. Mirrors every RU bot.* key; missing keys fall
 * back to RU at resolve time.
 */
export const botSr: Record<string, string> = {
  // --- Proof-of-shape keys (seeded by the foundation) ---
  "bot.menu.welcome": "Dobro došli u BeoSand!",
  "bot.menu.back": "Nazad",
  "bot.action.confirm": "Potvrdi",

  // --- Main menu (menu.ts) ---
  "bot.menu.welcomeFull":
    "Dobro došli u BeoSand 🏐\n\nOvde možete:\n• prijaviti se za trening\n• pogledati slobodna mesta\n• videti svoje prijave",
  "bot.menu.availableTrainings": "🎫 Pojedinačni dolazak",
  "bot.menu.todayFreeSlots": "📅 Slobodna mesta danas",
  "bot.menu.joinGroup": "👥 Prijava u grupu",
  "bot.menu.individual": "🧑‍🏫 Individualni trening",
  "bot.menu.myBookings": "📋 Moje prijave",
  "bot.menu.rentCourt": "🏖 Iznajmi teren",
  "bot.menu.contactManager": "ℹ️ Kontaktiraj menadžera",
  "bot.menu.language": "🌐 Jezik / Language",
  "bot.menu.adminCourtModeration": "🛠 Zahtevi za teren (admin)",
  "bot.menu.adminCourtLoad": "📊 Zauzetost terena (admin)",
  "bot.menu.contactManagerLine": "Kontaktiraj menadžera: {contact}",

  // --- Free spots today (navigation.ts, Feature 6) ---
  "bot.today.header": "Slobodna mesta za danas:",
  "bot.today.none": "Za danas nema slobodnih mesta. Pogledajte kasnije 🙌",

  // --- Individual training (individual.ts, Feature 8) ---
  "bot.individual.pickTrainer": "Kod kog trenera želite da se prijavite?",
  "bot.individual.noTrainers": "Trenutno nema dostupnih trenera. Pogledajte kasnije 🙌",
  "bot.individual.requested": "✅ Zahtev je poslat treneru. Kontaktiraće vas na Telegramu.",
  "bot.individual.trainerUnavailable":
    "Ovaj trener trenutno nije dostupan na Telegramu. Izaberite drugog ili kontaktirajte menadžera.",
  "bot.individual.pickButton": "🧑‍🏫 {name}",

  // --- Shared navigation (menu.ts) ---
  "bot.nav.back": "⬅️ Nazad",
  "bot.nav.home": "🏠 Glavni meni",
  "bot.nav.toMenu": "⬅️ U meni",
  "bot.nav.menuShort": "🏠 Meni",

  // --- Language switch (menu.ts / index.ts) ---
  "bot.language.prompt": "Izaberite jezik / Choose your language:",
  "bot.language.changed": "Jezik je promenjen. Trenutni jezik: {language}.",

  // --- Onboarding (onboarding.ts) ---
  "bot.onboarding.welcome":
    "Dobro došli u BeoSand 🏐\n\nHajde da se upoznamo. Kako se zovete?",
  "bot.onboarding.askLevel": "Koji je vaš nivo igre?",
  "bot.onboarding.askLanguage": "Na kom jeziku vam je lakše? / Choose your language:",
  "bot.onboarding.levelNone": "🤷 Ne znam",

  // --- Weekday short labels (shared by several screens) ---
  "bot.weekday.short.1": "Pon",
  "bot.weekday.short.2": "Uto",
  "bot.weekday.short.3": "Sre",
  "bot.weekday.short.4": "Čet",
  "bot.weekday.short.5": "Pet",
  "bot.weekday.short.6": "Sub",
  "bot.weekday.short.7": "Ned",
  // --- Weekday full labels (stats) ---
  "bot.weekday.full.1": "Ponedeljak",
  "bot.weekday.full.2": "Utorak",
  "bot.weekday.full.3": "Sreda",
  "bot.weekday.full.4": "Četvrtak",
  "bot.weekday.full.5": "Petak",
  "bot.weekday.full.6": "Subota",
  "bot.weekday.full.7": "Nedelja",
  // --- Month names (group booking) ---
  "bot.month.1": "januar",
  "bot.month.2": "februar",
  "bot.month.3": "mart",
  "bot.month.4": "april",
  "bot.month.5": "maj",
  "bot.month.6": "jun",
  "bot.month.7": "jul",
  "bot.month.8": "avgust",
  "bot.month.9": "septembar",
  "bot.month.10": "oktobar",
  "bot.month.11": "novembar",
  "bot.month.12": "decembar",

  // --- Available slots (slots.ts) ---
  "bot.slots.none": "Trenutno nema dostupnih treninga. Navratite kasnije 🙌",
  "bot.slots.header": "Dostupni treninzi:",
  "bot.slots.seats": "{count} mesta",
  "bot.slots.freeLine": "Slobodno: {seats} · {price} RSD",
  "bot.slots.book": "Prijavi se",
  "bot.slots.bookButton": "Prijavi se · {day} {time}",
  "bot.slots.notFound": "Ovaj trening više nije dostupan. Izaberite drugi sa liste.",
  "bot.slots.confirmTitle": "Potvrdite prijavu:",
  "bot.slots.confirmHint": "Pritisnite „Potvrdi prijavu“ da se prijavite.",
  "bot.slots.confirmButton": "✅ Potvrdi prijavu",
  "bot.slots.bookedTitle": "✅ Prijavljeni ste!",
  "bot.slots.bookedReminder": "Poslaćemo podsetnik pre treninga.",
  "bot.slots.bookedShort": "✅ Prijavljeni ste! Poslaćemo podsetnik pre treninga.",
  "bot.slots.moreTrainings": "🏐 Još treninga",
  "bot.slots.full":
    "Nažalost, mesta za ovaj trening više nema 😔\n\nŽelite li da se upišete na listu čekanja? Obavestićemo vas kada se mesto oslobodi.",
  "bot.slots.joinWaitlist": "⏳ Upiši se na listu čekanja",
  "bot.slots.otherTrainings": "🏐 Drugi treninzi",

  // --- My bookings (my-bookings.ts) ---
  "bot.myBookings.none": "Još nemate prijava. Prijavite se za trening 🏐",
  "bot.myBookings.notOnboarded":
    "Da biste videli svoje prijave, prvo se registrujte — pritisnite /start.",
  "bot.myBookings.upcomingHeader": "Predstojeći treninzi:",
  "bot.myBookings.pastHeader": "Prošli treninzi:",
  "bot.myBookings.outcome.attended": "✅ prisustvovano",
  "bot.myBookings.outcome.no_show": "🚫 nije došao",
  "bot.myBookings.outcome.cancelled": "❌ otkazano",
  "bot.myBookings.cancelButton": "❌ Otkaži · {day} {time}",
  "bot.myBookings.cancelConfirm":
    "Da li ste sigurni da želite da otkažete prijavu? Mesto će ponovo postati dostupno drugima.",
  "bot.myBookings.cancelDone": "✅ Prijava je otkazana.",
  "bot.myBookings.cancelConfirmButton": "✅ Da, otkaži",
  "bot.myBookings.bookAgain": "🏐 Prijavi se ponovo",

  // --- Group booking (group-booking.ts) ---
  "bot.group.none": "Trenutno nema grupa za prijavu. Navratite kasnije 🙌",
  "bot.group.header": "Grupe za mesečnu prijavu:",
  "bot.group.trainer": "Trener: {name}",
  "bot.group.monthSubscription": "Mesečna pretplata: {price} RSD",
  "bot.group.pickButton": "👥 {name}",
  "bot.group.monthPickTitle": "Grupa „{name}“",
  "bot.group.pickMonth": "Izaberite mesec prijave:",
  "bot.group.confirmTitle": "Prijava u grupu „{name}“",
  "bot.group.confirmMonth": "Mesec: {month}",
  "bot.group.confirmTotal": "Ukupno treninga u mesecu: {total}",
  "bot.group.confirmHint": "Pritisnite „Potvrdi prijavu“ da se prijavite za ceo mesec.",
  "bot.group.confirmButton": "✅ Potvrdi prijavu",
  "bot.group.successTitle": "✅ Prijavljeni ste u grupu za ceo mesec!",
  "bot.group.successBooked": "Prijavljeno treninga: {count}",
  "bot.group.successSkippedHeader": "Nije bilo moguće prijaviti (nema mesta):",
  "bot.group.successReminder": "Poslaćemo podsetnik pre svakog treninga.",
  "bot.group.notFound": "Ova grupa više nije dostupna. Izaberite drugu sa liste.",
  "bot.group.monthNotGenerated":
    "Za izabrani mesec raspored još nije formiran 😔\n\nProbajte drugi mesec ili se obratite menadžeru.",

  // --- Waitlist (waitlist.ts) ---
  "bot.waitlist.joined":
    "✅ Na listi ste čekanja!\n\nČim se mesto oslobodi, poslaćemo obaveštenje sa dugmetom za potvrdu.",
  "bot.waitlist.joinConflict":
    "Nije bilo moguće upisati na listu čekanja: mesto je još dostupno za običnu prijavu ili ste već na listi.",
  "bot.waitlist.acceptConflict":
    "Nažalost, mesto je već zauzeto ili je vreme za potvrdu isteklo 😔\n\nPogledajte dostupne treninge — možda ima drugih mesta.",

  // --- Court rental (court.ts) ---
  "bot.court.open": "🏖 Iznajmljivanje terena\n\nIzaberite datum:",
  "bot.court.pickTime": "Izaberite vreme početka:",
  "bot.court.pickDuration": "Izaberite trajanje:",
  "bot.court.noSlots": "Za ovaj datum nema slobodnih terena. Izaberite drugi datum.",
  "bot.court.submitted":
    "Zahtev je poslat administratoru na potvrdu. Sačekajte obaveštenje sa brojem terena.",
  "bot.court.durationHours": "{hours} č",
  "bot.court.duration.1": "1 sat",
  "bot.court.duration.1.5": "1.5 sata",
  "bot.court.duration.2": "2 sata",
  "bot.court.previewLine": "Datum: {date}, Vreme: {start}–{end} ({duration}). Ukupno: {price} RSD",
  "bot.court.previewUnavailable": "Nažalost, ovo vreme je već zauzeto. Izaberite drugo.",
  "bot.court.send": "✅ Pošalji zahtev",

  // --- Court moderation (court-moderation.ts) ---
  "bot.courtMod.queueTitle": "🛠 Zahtevi za iznajmljivanje terena",
  "bot.courtMod.empty": "Nema zahteva koji čekaju potvrdu.",
  "bot.courtMod.notAdmin": "Ovaj odeljak je dostupan samo administratoru.",
  "bot.courtMod.pick": "Izaberite teren za dodelu:",
  "bot.courtMod.noCourts": "Nema slobodnih terena za ovo vreme. Zahtev se može samo odbiti.",
  "bot.courtMod.confirmed": "✅ Potvrđeno. Klijent je obavešten.",
  "bot.courtMod.rejected": "🚫 Odbijeno. Klijent je obavešten.",
  "bot.courtMod.queueLine": "{date} {start}–{end} ({duration}) · {price} RSD · {client}",
  "bot.courtMod.confirmButton": "✅ #{index} Potvrdi",
  "bot.courtMod.rejectButton": "🚫 Odbij",
  "bot.courtMod.courtButton": "Teren br. {number}",
  "bot.courtMod.backToRequests": "⬅️ Na zahteve",

  // --- Court load grid (court-load.ts) ---
  "bot.courtLoad.title": "📊 Zauzetost terena",
  "bot.courtLoad.notAdmin": "Ovaj odeljak je dostupan samo administratoru.",
  "bot.courtLoad.pickDate": "Izaberite datum:",
  "bot.courtLoad.legend": "· slobodno   R zahtev   B blokada",
  "bot.courtLoad.otherDate": "📅 Drugi datum",

  // --- Trainer today (trainer-today.ts) ---
  "bot.trainer.notTrainer":
    "Ovaj odeljak je dostupan samo trenerima. Ako ste trener — obratite se menadžeru.",
  "bot.trainer.noToday": "Za danas nemate treninga 🙌",
  "bot.trainer.todayHeader": "Vaši treninzi danas:",
  "bot.trainer.emptyRoster": "Za ovaj trening još niko nije prijavljen.",
  "bot.trainer.attendance.attended": "✅ prisustvovao",
  "bot.trainer.attendance.no_show": "❌ nije došao",
  "bot.trainer.rosterButton": "📋 Spisak · {day} {time}",
  "bot.trainer.backToTrainings": "⬅️ Na treninge",

  // --- Broadcasts (broadcast.ts) ---
  "bot.broadcast.notAdmin":
    "Ovaj odeljak je dostupan samo menadžeru. Ako ste menadžer — obratite se administratoru.",
  "bot.broadcast.menu": "Koju obavest o slobodnim mestima pripremiti?",
  "bot.broadcast.noSlots":
    "Trenutno nema slobodnih mesta za ovu obavest. Izaberite drugi tip ili navratite kasnije.",
  "bot.broadcast.type.today": "Danas",
  "bot.broadcast.type.tomorrow": "Sutra",
  "bot.broadcast.type.week": "Za nedelju",
  "bot.broadcast.type.freed-up": "Oslobođena mesta",
  "bot.broadcast.audiencePrompt": "Kome poslati obavest?",
  "bot.broadcast.pickLevel": "Izaberite nivo za obavest:",
  "bot.broadcast.audience.all": "Svim aktivnima",
  "bot.broadcast.audience.level": "Po nivou",
  "bot.broadcast.audience.active": "Aktivnima (za {days} dana)",
  "bot.broadcast.audience.lapsed": "Odavno nisu bili ({days} dana)",
  "bot.broadcast.slotButton": "Prijavi se · {day} {time}",
  "bot.broadcast.send": "📨 Pošalji",
  "bot.broadcast.changeAudience": "👥 Promeni publiku",
  "bot.broadcast.previewRecipients": "Primalaca u segmentu: {count}",
  "bot.broadcast.previewHint": "Pritisnite „Pošalji“ da pošaljete obavest.",
  "bot.broadcast.sent": "✅ Obavest je poslata {count} primalaca.",
  "bot.broadcast.another": "📨 Druga obavest",

  // --- Stats / analytics summary (stats.ts) ---
  "bot.stats.title": "📊 Pregled škole",
  "bot.stats.period": "Period: {from} — {to}",
  "bot.stats.totalBookings": "Ukupno prijava: {count}",
  "bot.stats.fillRate": "Popunjenost: {percent}",
  "bot.stats.cancellations": "Otkazivanja: {percent}",
  "bot.stats.noShows": "Nedolasci: {percent}",
  "bot.stats.activeClients": "Aktivnih klijenata: {count}",
  "bot.stats.attributed": "Prijava nakon obavesti: {count}",
  "bot.stats.topSlot": "Popularan termin: {day} {time} ({count})",
  "bot.stats.topSlotNone": "Popularan termin: —",

  // --- Manager console (manager-menu.ts) ---
  "bot.manager.menu": "Meni menadžera. Izaberite radnju:",
  "bot.manager.noTrainings":
    "U narednih 30 dana nema treninga. Generišite raspored za mesec.",
  "bot.manager.overviewHeader": "Popunjenost treninga (30 dana):",
  "bot.manager.pickCancel": "Koji trening otkazati?",
  "bot.manager.pickCap": "Kom treningu promeniti kapacitet?",
  "bot.manager.cancelDone":
    "✅ Trening je otkazan. Prijavljeni klijenti su obavešteni, mesta su oslobođena.",
  "bot.manager.cancelAlready": "Ovaj trening je već otkazan.",
  "bot.manager.cancelNotFound": "Trening nije pronađen.",
  "bot.manager.capDone": "✅ Kapacitet je ažuriran.",
  "bot.manager.capBelowBooked":
    "Nije moguće postaviti kapacitet manji od broja već prijavljenih. Izaberite veću vrednost.",
  "bot.manager.status.open": "otvoren",
  "bot.manager.status.full": "popunjen",
  "bot.manager.status.cancelled": "otkazan",
  "bot.manager.status.completed": "završen",
  "bot.manager.btn.overview": "📊 Pregled popunjenosti",
  "bot.manager.btn.capacity": "🔢 Promeni kapacitet",
  "bot.manager.btn.cancel": "🚫 Otkaži trening",
  "bot.manager.btn.broadcasts": "📨 Obavesti",
  "bot.manager.btn.stats": "📈 Pregled škole",
  "bot.manager.overviewLine": "{booked}/{capacity} · {status}",
  "bot.manager.cancelConfirmTitle": "Otkazati trening {date}, {start}–{end}?",
  "bot.manager.cancelConfirmBody": "Prijavljeno: {booked}. Svi prijavljeni klijenti biće obavešteni.",
  "bot.manager.cancelConfirmButton": "✅ Da, otkaži",
  "bot.manager.cancelButton": "🚫 {label}",
  "bot.manager.capButton": "🔢 {label}",
  "bot.manager.capPickTitle": "Trening {date}, {start}–{end}.",
  "bot.manager.capPickCurrent": "Trenutno: {booked}/{capacity}.",
  "bot.manager.capPickPrompt": "Izaberite novi kapacitet:",
  "bot.manager.capCurrentOption": "{count} (trenutno)",

  // --- Slot filters (slot-filters.ts) ---
  "bot.filter.timeOfDay.morning": "Jutro",
  "bot.filter.timeOfDay.afternoon": "Popodne",
  "bot.filter.timeOfDay.evening": "Veče",
  "bot.filter.trainerFallback": "trener",
  "bot.filter.levelFallback": "nivo",
  "bot.filter.active": "Filteri: {filters}",
  "bot.filter.none": "Filteri nisu izabrani",
  "bot.filter.chip.weekday": "Dan u nedelji",
  "bot.filter.chip.time": "Vreme",
  "bot.filter.chip.trainer": "Trener",
  "bot.filter.chip.level": "Nivo",
  "bot.filter.clear": "🧹 Poništi filtere",
  "bot.filter.anyWeekday": "Bilo koji dan",
  "bot.filter.anyTime": "Bilo koje vreme",
  "bot.filter.anyTrainer": "Bilo koji trener",
  "bot.filter.anyLevel": "Bilo koji nivo",
  "bot.filter.backToList": "⬅️ Na listu",
  "bot.filter.pickWeekday": "Izaberite dan u nedelji:",
  "bot.filter.pickTimeOfDay": "Izaberite doba dana:",
  "bot.filter.pickTrainer": "Izaberite trenera:",
  "bot.filter.pickLevel": "Izaberite nivo:"
};
