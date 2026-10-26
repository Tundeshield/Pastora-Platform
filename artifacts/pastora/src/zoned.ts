/**
 * Dates in the church's own time zone, so a pastor in Lagos and a helper abroad see
 * the same times, and visitors see the time the meeting actually happens.
 */

export function safeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function fmt(value: string | Date | number, tz: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: safeZone(tz), ...options }).format(new Date(value));
}

export const timeOf = (v: string | Date | number, tz: string) => fmt(v, tz, { hour: "numeric", minute: "2-digit" });
export const dayOf = (v: string | Date | number, tz: string) =>
  fmt(v, tz, { weekday: "long", day: "numeric", month: "long" });
export const shortDay = (v: string | Date | number, tz: string) =>
  fmt(v, tz, { weekday: "short", day: "numeric", month: "short" });

/** "2026-11-03" for the day an instant falls on in the zone. */
export function dateKey(value: string | Date | number, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
  return p; // en-CA formats as YYYY-MM-DD
}

function offsetAt(tz: string, ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(tz),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour % 24, +v.minute);
  return asUtc - Math.floor(ms / 60000) * 60000;
}

/** A "YYYY-MM-DDTHH:MM" wall-clock value in the zone, as an ISO instant. */
export function zonedToIso(local: string, tz: string): string {
  const [date, time = "00:00"] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - offsetAt(tz, wall);
  return new Date(wall - offsetAt(tz, first)).toISOString();
}

/** The friendly name of a zone, e.g. "West Africa Standard Time". */
export function zoneName(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZone: safeZone(tz), timeZoneName: "long" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** A tiny .ics file so people can add a booking to their own calendar. */
export function icsFile(opts: { start: string; minutes: number; title: string; location?: string | null }): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(opts.start).getTime();
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pastora//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${start}-${Math.random().toString(36).slice(2)}@pastora`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + opts.minutes * 60000)}`,
    `SUMMARY:${esc(opts.title)}`,
    ...(opts.location ? [`LOCATION:${esc(opts.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}
