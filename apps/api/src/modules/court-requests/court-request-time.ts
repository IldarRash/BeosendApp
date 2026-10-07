/** Returns whether a venue-local request start instant has arrived. */
export function courtRequestStarted(date: string, startTime: string, now = new Date()): boolean {
  const time = startTime.slice(0, 5);
  const start = earliestVenueWallClockInstant(date, time);
  if (start) return start.getTime() <= now.getTime();
  const venueNow = venueWallClockParts(now);
  return date < venueNow.date || (date === venueNow.date && time <= venueNow.time);
}

/** During autumn DST repetition, cancellation closes at the first occurrence. */
function earliestVenueWallClockInstant(date: string, time: string): Date | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = new Set([-12, 0, 12].map((hours) => {
    const at = new Date(guess + hours * 60 * 60 * 1000);
    const local = venueWallClockParts(at);
    return Date.UTC(Number(local.date.slice(0, 4)), Number(local.date.slice(5, 7)) - 1, Number(local.date.slice(8, 10)), Number(local.time.slice(0, 2)), Number(local.time.slice(3, 5))) - at.getTime();
  }));
  const candidates = [...offsets].map((offset) => new Date(guess - offset)).filter((candidate) => {
    const local = venueWallClockParts(candidate);
    return local.date === date && local.time === time;
  }).sort((left, right) => left.getTime() - right.getTime());
  return candidates[0] ?? null;
}

function venueWallClockParts(now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Belgrade", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const part = (type: string): number => Number(parts.find((item) => item.type === type)?.value ?? "0");
  return { date: `${part("year")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}`, time: `${String(part("hour") % 24).padStart(2, "0")}:${String(part("minute")).padStart(2, "0")}` };
}
