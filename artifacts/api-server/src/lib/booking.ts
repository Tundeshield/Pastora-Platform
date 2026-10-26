/**
 * Calendly-style booking: the pastor's weekly hours, minus time off, minus what is
 * already booked, cut into meeting-length slots in the church's time zone.
 * Pure functions, so the rules are easy to test.
 */

export type Format = "in-person" | "phone" | "video";

export interface WeeklyHours {
  day: number; // 0 = Sunday
  start: string; // "HH:MM" church time
  end: string;
}

export interface TimeOff {
  startAt: Date;
  endAt: Date;
  label?: string | null;
}

export interface Availability {
  bookingEnabled: boolean;
  weekly: WeeklyHours[];
  meetingMinutes: number;
  bufferMinutes: number;
  noticeHours: number;
  horizonDays: number;
  autoConfirm: boolean;
  formats: Format[];
  location: string | null;
  timeOff: TimeOff[];
}

export interface Busy {
  start: number;
  end: number;
}

export const DEFAULT_AVAILABILITY: Availability = {
  bookingEnabled: true,
  weekly: [],
  meetingMinutes: 45,
  bufferMinutes: 15,
  noticeHours: 24,
  horizonDays: 21,
  autoConfirm: true,
  formats: ["in-person", "phone", "video"],
  location: null,
  timeOff: [],
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function validTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function partsIn(tz: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    y: Number(v.year),
    m: Number(v.month),
    d: Number(v.day),
    h: Number(v.hour) % 24,
    min: Number(v.minute),
    s: Number(v.second),
  };
}

/** How far the zone is ahead of UTC at that instant, in ms. */
function offsetAt(tz: string, date: Date): number {
  const p = partsIn(tz, date);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a wall-clock time happens in a zone. */
export function zonedTime(tz: string, y: number, m: number, d: number, h: number, min: number): number {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - offsetAt(tz, new Date(wall));
  const second = wall - offsetAt(tz, new Date(first));
  return second;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Removes empty, backwards and duplicated ranges and sorts by day and time. */
export function cleanWeekly(weekly: WeeklyHours[]): WeeklyHours[] {
  const seen = new Set<string>();
  return weekly
    .filter((w) => Number.isInteger(w.day) && w.day >= 0 && w.day <= 6)
    .filter((w) => minutesOf(w.end) > minutesOf(w.start))
    .filter((w) => {
      const key = `${w.day}-${w.start}-${w.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.day - b.day || minutesOf(a.start) - minutesOf(b.start));
}

export interface SlotDay {
  date: string;
  slots: string[];
}

export function computeSlots(
  availability: Availability,
  timeZone: string,
  busy: Busy[],
  now: number = Date.now(),
): SlotDay[] {
  const tz = validTimeZone(timeZone);
  const meeting = availability.meetingMinutes * MINUTE;
  const buffer = availability.bufferMinutes * MINUTE;
  const step = meeting + buffer;
  const earliest = now + availability.noticeHours * 60 * MINUTE;
  const blocked: Busy[] = [
    ...busy.map((b) => ({ start: b.start - buffer, end: b.end + buffer })),
    ...availability.timeOff.map((t) => ({ start: t.startAt.getTime(), end: t.endAt.getTime() })),
  ];
  const today = partsIn(tz, new Date(now));
  const days: SlotDay[] = [];
  for (let i = 0; i < availability.horizonDays; i += 1) {
    const civil = new Date(Date.UTC(today.y, today.m - 1, today.d) + i * DAY);
    const y = civil.getUTCFullYear();
    const m = civil.getUTCMonth() + 1;
    const d = civil.getUTCDate();
    const weekday = civil.getUTCDay();
    const slots = new Set<number>();
    for (const range of availability.weekly) {
      if (range.day !== weekday) continue;
      const startMin = minutesOf(range.start);
      const endMin = minutesOf(range.end);
      const rangeEnd = zonedTime(tz, y, m, d, Math.floor(endMin / 60), endMin % 60);
      let cursor = zonedTime(tz, y, m, d, Math.floor(startMin / 60), startMin % 60);
      while (cursor + meeting <= rangeEnd) {
        const end = cursor + meeting;
        const clash = blocked.some((b) => cursor < b.end && end > b.start);
        if (cursor >= earliest && !clash) slots.add(cursor);
        cursor += step;
      }
    }
    if (slots.size) {
      days.push({
        date: `${y}-${pad(m)}-${pad(d)}`,
        slots: [...slots].sort((a, b) => a - b).map((t) => new Date(t).toISOString()),
      });
    }
  }
  return days;
}

/** Whether an exact start time is one of the open slots right now. */
export function isOpenSlot(
  startAt: Date,
  availability: Availability,
  timeZone: string,
  busy: Busy[],
  now: number = Date.now(),
): boolean {
  const iso = startAt.toISOString();
  return computeSlots(availability, timeZone, busy, now).some((day) => day.slots.includes(iso));
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Reads stored availability, filling gaps with defaults (old churches have none). */
export function availabilityFrom(
  stored: Record<string, unknown> | undefined,
  settings: Record<string, unknown>,
): Availability & { configured: boolean } {
  const s = stored ?? {};
  const formats = Array.isArray(s.formats)
    ? (s.formats as unknown[]).filter((f): f is Format => f === "in-person" || f === "phone" || f === "video")
    : [];
  const timeOff = Array.isArray(s.timeOff)
    ? (s.timeOff as Record<string, unknown>[])
        .flatMap((t): TimeOff[] => {
          const startAt = toDate(t.startAt);
          const endAt = toDate(t.endAt);
          return startAt && endAt ? [{ startAt, endAt, label: typeof t.label === "string" ? t.label : null }] : [];
        })
    : [];
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const weekly = Array.isArray(s.weekly) ? cleanWeekly(s.weekly as WeeklyHours[]) : [];
  return {
    bookingEnabled: settings.appointmentEnabled !== false,
    weekly,
    meetingMinutes: num(s.meetingMinutes, Number(settings.appointmentDurationMinutes) || DEFAULT_AVAILABILITY.meetingMinutes),
    bufferMinutes: num(s.bufferMinutes, DEFAULT_AVAILABILITY.bufferMinutes),
    noticeHours: num(s.noticeHours, DEFAULT_AVAILABILITY.noticeHours),
    horizonDays: num(s.horizonDays, DEFAULT_AVAILABILITY.horizonDays),
    autoConfirm: typeof s.autoConfirm === "boolean" ? s.autoConfirm : DEFAULT_AVAILABILITY.autoConfirm,
    formats: formats.length ? formats : DEFAULT_AVAILABILITY.formats,
    location: typeof s.location === "string" && s.location.trim() ? s.location : null,
    timeOff,
    configured: weekly.length > 0,
  };
}

/** Appointments that hold a time: confirmed ones and requests not yet answered. */
export function busyFrom(records: Record<string, unknown>[], excludeId?: string): Busy[] {
  return records
    .filter((r) => r.id !== excludeId && (r.status === "confirmed" || r.status === "requested"))
    .map((r) => {
      const start = toDate(r.startAt)?.getTime() ?? Number.NaN;
      return { start, end: start + Number(r.durationMinutes ?? 45) * MINUTE };
    })
    .filter((b) => Number.isFinite(b.start));
}
