import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AVAILABILITY, availabilityFrom, busyFrom, computeSlots, isOpenSlot, zonedTime } from "./booking";

// Monday 2 November 2026, 08:00 in Lagos (UTC+1) = 07:00 UTC.
const NOW = Date.UTC(2026, 10, 2, 7, 0);
const base = {
  ...DEFAULT_AVAILABILITY,
  weekly: [{ day: 2, start: "10:00", end: "12:00" }], // Tuesdays
  meetingMinutes: 45,
  bufferMinutes: 15,
  noticeHours: 2,
  horizonDays: 14,
};

test("zonedTime converts church wall-clock time to UTC", () => {
  assert.equal(new Date(zonedTime("Africa/Lagos", 2026, 11, 3, 10, 0)).toISOString(), "2026-11-03T09:00:00.000Z");
  assert.equal(new Date(zonedTime("Europe/London", 2026, 7, 1, 10, 0)).toISOString(), "2026-07-01T09:00:00.000Z");
  assert.equal(new Date(zonedTime("Europe/London", 2026, 12, 1, 10, 0)).toISOString(), "2026-12-01T10:00:00.000Z");
});

test("weekly hours become meeting-length slots with a buffer between them", () => {
  const days = computeSlots(base, "Africa/Lagos", [], NOW);
  assert.deepEqual(days.map((d) => d.date), ["2026-11-03", "2026-11-10"]);
  // 10:00 and 11:00 Lagos; 11:00 + 45 = 11:45 fits before 12:00, 12:00 would not.
  assert.deepEqual(days[0].slots, ["2026-11-03T09:00:00.000Z", "2026-11-03T10:00:00.000Z"]);
});

test("booked times, buffers and time off remove slots", () => {
  const busy = [{ start: Date.UTC(2026, 10, 3, 9, 0), end: Date.UTC(2026, 10, 3, 9, 30) }];
  const days = computeSlots(base, "Africa/Lagos", busy, NOW);
  assert.deepEqual(days[0].slots, ["2026-11-03T10:00:00.000Z"]);
  const away = computeSlots(
    { ...base, timeOff: [{ startAt: new Date("2026-11-09T00:00:00Z"), endAt: new Date("2026-11-11T00:00:00Z") }] },
    "Africa/Lagos",
    [],
    NOW,
  );
  assert.deepEqual(away.map((d) => d.date), ["2026-11-03"]);
});

test("minimum notice hides slots that are too soon", () => {
  const days = computeSlots({ ...base, noticeHours: 26 }, "Africa/Lagos", [], NOW);
  // Tuesday 10:00 Lagos is 26h after Monday 08:00, so 10:00 stays and nothing earlier exists.
  assert.equal(days[0].slots[0], "2026-11-03T09:00:00.000Z");
  const later = computeSlots({ ...base, noticeHours: 27 }, "Africa/Lagos", [], NOW);
  assert.equal(later[0].slots[0], "2026-11-03T10:00:00.000Z");
});

test("isOpenSlot only accepts exact open times", () => {
  assert.equal(isOpenSlot(new Date("2026-11-03T09:00:00Z"), base, "Africa/Lagos", [], NOW), true);
  assert.equal(isOpenSlot(new Date("2026-11-03T09:15:00Z"), base, "Africa/Lagos", [], NOW), false);
  assert.equal(isOpenSlot(new Date("2026-11-04T09:00:00Z"), base, "Africa/Lagos", [], NOW), false);
});

test("stored data is read safely, with defaults for older churches", () => {
  const a = availabilityFrom(undefined, { appointmentDurationMinutes: 30 });
  assert.equal(a.configured, false);
  assert.equal(a.meetingMinutes, 30);
  assert.equal(a.bookingEnabled, true);
  const b = availabilityFrom({ weekly: [{ day: 1, start: "12:00", end: "11:00" }] }, { appointmentEnabled: false });
  assert.equal(b.configured, false);
  assert.equal(b.bookingEnabled, false);
  const busy = busyFrom([
    { id: "a", status: "confirmed", startAt: new Date("2026-11-03T09:00:00Z"), durationMinutes: 30 },
    { id: "b", status: "declined", startAt: new Date("2026-11-03T10:00:00Z") },
    { id: "c", status: "requested", startAt: "2026-11-03T11:00:00Z" },
  ]);
  assert.equal(busy.length, 2);
});
