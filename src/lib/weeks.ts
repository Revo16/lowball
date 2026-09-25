// Week math for the NFL calendar, all in Pacific time.
// Pure functions, no imports, so they run under `npm test` without Next.

export const TZ = "America/Los_Angeles";
const DAY = 86_400_000;

/** "YYYY-MM-DD" for the given instant as seen in Pacific time. */
export function ptDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMidnight(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  return fromUtcMidnight(toUtcMidnight(ymd) + days * DAY);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY);
}

/** Thursday of Week 1: first Thursday on or after Sleeper's season_start_date. */
export function week1Thursday(seasonStart: string): string {
  const dow = new Date(toUtcMidnight(seasonStart)).getUTCDay(); // 0 Sun .. 4 Thu
  return addDays(seasonStart, (4 - dow + 7) % 7);
}

/**
 * The latest week whose Monday night game is over. Week W runs Thursday
 * through Monday and counts as complete from Tuesday 00:00 PT.
 */
export function completedWeek(seasonStart: string, now: Date): number {
  const firstTuesday = addDays(week1Thursday(seasonStart), 5);
  const days = diffDays(firstTuesday, ptDate(now));
  if (days < 0) return 0;
  return Math.floor(days / 7) + 1;
}

/** The week whose parlay people are picking right now. */
export function parlayWeek(seasonStart: string, now: Date, lastWeek = 18): number {
  return Math.min(completedWeek(seasonStart, now) + 1, lastWeek);
}

/** UTC instant for a wall-clock time in Pacific time (handles PDT/PST). */
export function ptWallTimeToUtc(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  // Find what Pacific wall time that guess corresponds to, and correct by the difference.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const seenAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess + (guess - seenAsUtc));
}

/** Picks lock Saturday of that week at 8:00 PM PT. */
export function lockTime(seasonStart: string, week: number, hour = 20): Date {
  const saturday = addDays(week1Thursday(seasonStart), 7 * (week - 1) + 2);
  return ptWallTimeToUtc(saturday, hour);
}

/** Tuesday 00:00 PT after the week's Monday night game: end of the betting window. */
export function weekEnd(seasonStart: string, week: number): Date {
  const tuesday = addDays(week1Thursday(seasonStart), 7 * (week - 1) + 5);
  return ptWallTimeToUtc(tuesday, 0);
}

export function formatPt(d: Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  }).format(d);
}
