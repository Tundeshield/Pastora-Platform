import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAvailabilityQueryKey,
  getGetDashboardQueryKey,
  getGetPublicSlotsQueryKey,
  getListAppointmentsQueryKey,
  useCreateAppointment,
  useGetAvailability,
  useGetPublicSlots,
  useListAppointments,
  useSaveAvailability,
  useUpdateAppointment,
  type Appointment,
  type AvailabilityInput,
  type WeeklyHours,
} from "@workspace/api-client-react";
import { CalendarCheck, CalendarClock, Check, Copy, ExternalLink, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useSession } from "@/auth";
import {
  Badge,
  Button,
  EmptyState,
  ErrorPanel,
  Field,
  MutationError,
  PageHeading,
  SkeletonRows,
  Toggle,
  formatLabel,
} from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";
import { churchUrl } from "@/site";
import { dateKey, dayOf, fmt, shortDay, timeOf, zoneName, zonedToIso } from "@/zoned";

type Format = "in-person" | "phone" | "video";
type Tab = "schedule" | "availability";

/** Monday first, the way most church calendars are read. */
const WEEK: { day: number; name: string }[] = [
  { day: 1, name: "Monday" },
  { day: 2, name: "Tuesday" },
  { day: 3, name: "Wednesday" },
  { day: 4, name: "Thursday" },
  { day: 5, name: "Friday" },
  { day: 6, name: "Saturday" },
  { day: 0, name: "Sunday" },
];
const FORMATS: { value: Format; label: string }[] = [
  { value: "in-person", label: "In person" },
  { value: "phone", label: "Phone call" },
  { value: "video", label: "Video call" },
];

export function bookingUrl(slug: string): string {
  const url = new URL(churchUrl(slug, { page: "care" }));
  url.searchParams.set("type", "appointment");
  return url.toString();
}

export function AppointmentsPage() {
  const session = useSession();
  const slug = session.data?.church?.slug ?? "";
  const tz = session.data?.church?.timeZone ?? "UTC";
  const [tab, setTab] = useState<Tab>("schedule");
  const availability = useGetAvailability({ query: { queryKey: getGetAvailabilityQueryKey(), retry: 1 } });
  return (
    <>
      <PageHeading
        eyebrow="Time for people"
        title="Appointments"
        subtitle="Choose when you can meet. People pick an open time from your care page, and it lands here."
      />
      <div className="admin-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "schedule"} onClick={() => setTab("schedule")}>
          Schedule
        </button>
        <button role="tab" aria-selected={tab === "availability"} onClick={() => setTab("availability")}>
          Availability
        </button>
      </div>
      {tab === "schedule" ? (
        <Schedule
          tz={tz}
          slug={slug}
          configured={availability.data?.configured}
          bookingEnabled={availability.data?.bookingEnabled}
          openAvailability={() => setTab("availability")}
        />
      ) : availability.isLoading ? (
        <SkeletonRows />
      ) : availability.isError || !availability.data ? (
        <ErrorPanel
          text={apiErrorMessage(availability.error, "Availability is unavailable.")}
          retry={() => void availability.refetch()}
        />
      ) : (
        <AvailabilityEditor initial={availability.data} slug={slug} tz={availability.data.timeZone} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ schedule */

function BookingLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = bookingUrl(slug);
  return (
    <div className="booking-link">
      <CalendarCheck size={18} />
      <div>
        <b>Your booking link</b>
        <code>{url}</code>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => window.prompt("Copy this link", url));
        }}
      >
        <Copy size={14} /> {copied ? "Copied" : "Copy"}
      </Button>
      <a className="button quiet" href={url} target="_blank" rel="noreferrer">
        <ExternalLink size={14} /> Open
      </a>
    </div>
  );
}

function Schedule({
  tz,
  slug,
  configured,
  bookingEnabled,
  openAvailability,
}: {
  tz: string;
  slug: string;
  configured?: boolean;
  bookingEnabled?: boolean;
  openAvailability: () => void;
}) {
  const q = useListAppointments({ query: { queryKey: getListAppointmentsQueryKey(), retry: 1 } });
  const update = useUpdateAppointment();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    if (slug) void qc.invalidateQueries({ queryKey: getGetPublicSlotsQueryKey(slug) });
  };
  const setStatus = (a: Appointment, status: Appointment["status"]) =>
    update.mutate({ appointmentId: a.id, data: { status } }, { onSuccess: invalidate });

  const { waiting, upcoming, past } = useMemo(() => {
    const now = Date.now();
    const all = q.data ?? [];
    const end = (a: Appointment) => new Date(a.startAt).getTime() + a.durationMinutes * 60000;
    return {
      waiting: all.filter((a) => a.status === "requested" && end(a) > now),
      upcoming: all.filter((a) => a.status === "confirmed" && end(a) > now),
      past: all
        .filter((a) => end(a) <= now || ["completed", "declined", "cancelled"].includes(a.status))
        .filter((a) => !(a.status === "requested" && end(a) > now))
        .reverse()
        .slice(0, 30),
    };
  }, [q.data]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const a of upcoming) {
      const key = dateKey(a.startAt, tz);
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    return [...groups.entries()];
  }, [upcoming, tz]);

  return (
    <>
      {configured === false && (
        <div className="setup-banner booking-setup">
          <CalendarClock size={18} />
          <span>
            <b>Set your hours and people can book an open time themselves.</b> Until then, the care page asks
            for a preferred time and you confirm it here.
          </span>
          <Button onClick={openAvailability}>Set availability</Button>
        </div>
      )}
      {configured && bookingEnabled === false && (
        <div className="setup-banner booking-setup">
          <CalendarClock size={18} />
          <span>Online booking is switched off. Your care page doesn't offer appointments right now.</span>
          <Button variant="outline" onClick={openAvailability}>
            Turn it on
          </Button>
        </div>
      )}
      {slug && configured && bookingEnabled !== false && <BookingLink slug={slug} />}

      <div className="schedule-actions">
        <Button variant="outline" onClick={() => setAdding(!adding)}>
          <Plus size={15} /> Add an appointment
        </Button>
      </div>
      {adding && <AddAppointment tz={tz} onDone={() => (setAdding(false), invalidate())} />}
      <MutationError errors={[update.error]} />

      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel text={apiErrorMessage(q.error, "Appointments are unavailable.")} retry={() => void q.refetch()} />
      ) : (
        <>
          {waiting.length > 0 && (
            <section className="schedule-section">
              <h2 className="serif">Waiting for your answer</h2>
              <div className="appt-list">
                {waiting.map((a) => (
                  <AppointmentRow key={a.id} a={a} tz={tz} withDay>
                    <Button variant="small" onClick={() => setStatus(a, "confirmed")}>
                      <Check size={14} /> Confirm
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        if (window.confirm(`Decline ${a.requesterName}'s request? The time opens up again.`))
                          setStatus(a, "declined");
                      }}
                    >
                      <X size={14} /> Decline
                    </Button>
                  </AppointmentRow>
                ))}
              </div>
            </section>
          )}
          <section className="schedule-section">
            <h2 className="serif">Coming up</h2>
            {byDay.length ? (
              byDay.map(([key, items]) => (
                <div className="appt-day" key={key}>
                  <h3>{dayOf(items[0].startAt, tz)}</h3>
                  <div className="appt-list">
                    {items.map((a) => (
                      <AppointmentRow key={a.id} a={a} tz={tz}>
                        <select
                          aria-label={`Change ${a.requesterName}'s appointment`}
                          value=""
                          onChange={(e) => {
                            const v = e.target.value as Appointment["status"];
                            if (v === "cancelled" && !window.confirm("Cancel this appointment? The time opens up again."))
                              return;
                            setStatus(a, v);
                          }}
                        >
                          <option value="" disabled>
                            Change…
                          </option>
                          <option value="completed">Mark as done</option>
                          <option value="cancelled">Cancel</option>
                        </select>
                      </AppointmentRow>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="Nothing booked yet"
                description="Confirmed conversations appear here, grouped by day."
              />
            )}
          </section>
          {past.length > 0 && (
            <section className="schedule-section">
              <button className="under-link" onClick={() => setShowPast(!showPast)}>
                {showPast ? "Hide past and closed" : `Show past and closed (${past.length})`}
              </button>
              {showPast && (
                <div className="appt-list past">
                  {past.map((a) => (
                    <AppointmentRow key={a.id} a={a} tz={tz} withDay />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

function AppointmentRow({
  a,
  tz,
  withDay = false,
  children,
}: {
  a: Appointment;
  tz: string;
  withDay?: boolean;
  children?: React.ReactNode;
}) {
  const end = new Date(a.startAt).getTime() + a.durationMinutes * 60000;
  return (
    <article className="appt-row">
      <div className="appt-time">
        {withDay && <small>{shortDay(a.startAt, tz)}</small>}
        <b>{timeOf(a.startAt, tz)}</b>
        <small>to {timeOf(end, tz)}</small>
      </div>
      <div className="appt-body">
        <div className="appt-name">
          <b>{a.requesterName}</b>
          <Badge label={a.status} />
        </div>
        {a.topic && <p>{a.topic}</p>}
        <small>
          {formatLabel(a.format)}
          {a.contact ? ` · ${a.contact}` : ""}
          {a.source === "public_portal" ? " · booked online" : ""}
        </small>
      </div>
      {children && <div className="appt-actions">{children}</div>}
    </article>
  );
}

function AddAppointment({ tz, onDone }: { tz: string; onDone: () => void }) {
  const create = useCreateAppointment();
  const [form, setForm] = useState({
    requesterName: "",
    contact: "",
    topic: "",
    startAt: "",
    durationMinutes: "45",
    format: "in-person" as Format,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          requesterName: form.requesterName,
          contact: form.contact || null,
          topic: form.topic || null,
          durationMinutes: Number(form.durationMinutes),
          status: "confirmed",
          startAt: zonedToIso(form.startAt, tz),
          format: form.format,
        },
      },
      { onSuccess: onDone },
    );
  };
  return (
    <form className="inline-form grid-form" onSubmit={submit}>
      <Field label="Who">
        <input required value={form.requesterName} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} />
      </Field>
      <Field label="Phone or email">
        <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
      </Field>
      <Field label="About (optional)">
        <input maxLength={2000} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
      </Field>
      <Field label="Date and time">
        <input
          required
          type="datetime-local"
          value={form.startAt}
          onChange={(e) => setForm({ ...form, startAt: e.target.value })}
        />
      </Field>
      <Field label="Minutes">
        <input
          type="number"
          min="15"
          max="240"
          value={form.durationMinutes}
          onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
        />
      </Field>
      <Field label="How">
        <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as Format })}>
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      <MutationError errors={[create.error]} />
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Saving…" : "Save appointment"}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------- availability */

const MEETING = [15, 20, 30, 45, 60, 90];
const BUFFER = [0, 5, 10, 15, 30];
const NOTICE: { value: number; label: string }[] = [
  { value: 0, label: "No notice needed" },
  { value: 2, label: "2 hours" },
  { value: 4, label: "4 hours" },
  { value: 12, label: "12 hours" },
  { value: 24, label: "1 day" },
  { value: 48, label: "2 days" },
  { value: 168, label: "1 week" },
];
const HORIZON = [7, 14, 21, 30, 60, 90];

function AvailabilityEditor({ initial, slug, tz }: { initial: AvailabilityInput; slug: string; tz: string }) {
  const save = useSaveAvailability();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<AvailabilityInput>(() => ({
    ...initial,
    // A first visit starts from a sensible week the pastor can adjust.
    weekly: initial.weekly.length
      ? initial.weekly
      : [2, 3, 4].map((day) => ({ day, start: "10:00", end: "16:00" })),
  }));
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => setSaved(false), [draft]);

  const rangesFor = (day: number) => draft.weekly.filter((w) => w.day === day);
  const setRanges = (day: number, ranges: WeeklyHours[]) =>
    setDraft({ ...draft, weekly: [...draft.weekly.filter((w) => w.day !== day), ...ranges] });

  const submit = () =>
    save.mutate(
      { data: draft },
      {
        onSuccess: (result) => {
          qc.setQueryData(getGetAvailabilityQueryKey(), result);
          if (slug) void qc.invalidateQueries({ queryKey: getGetPublicSlotsQueryKey(slug) });
          setDraft(result);
          setSaved(true);
        },
      },
    );

  return (
    <div className="availability">
      <section className="settings-section">
        <div>
          <p className="eyebrow">Online booking</p>
          <h2 className="serif">Let people book you</h2>
          <p>
            People see only open times, never what's already booked. Times are in {zoneName(tz)}, your church's
            time zone.
          </p>
        </div>
        <div className="settings-fields">
          <Toggle
            label="People can book a conversation from the care page"
            value={draft.bookingEnabled}
            onChange={(v) => setDraft({ ...draft, bookingEnabled: v })}
          />
          <Toggle
            label="Confirm bookings straight away (turn off to approve each one)"
            value={draft.autoConfirm}
            onChange={(v) => setDraft({ ...draft, autoConfirm: v })}
          />
        </div>
      </section>

      <section className="settings-section">
        <div>
          <p className="eyebrow">Weekly hours</p>
          <h2 className="serif">When you're free</h2>
          <p>Add the hours you keep for people each week. You can have more than one block in a day.</p>
        </div>
        <div className="week-grid">
          {WEEK.map(({ day, name }) => {
            const ranges = rangesFor(day);
            return (
              <div className="week-day" key={day}>
                <label className="week-day-name">
                  <input
                    type="checkbox"
                    checked={ranges.length > 0}
                    onChange={(e) => setRanges(day, e.target.checked ? [{ day, start: "10:00", end: "16:00" }] : [])}
                  />
                  <b>{name}</b>
                </label>
                <div className="week-ranges">
                  {ranges.length === 0 && <span className="muted">Unavailable</span>}
                  {ranges.map((r, i) => (
                    <div className="week-range" key={i}>
                      <input
                        type="time"
                        aria-label={`${name} from`}
                        value={r.start}
                        onChange={(e) =>
                          setRanges(
                            day,
                            ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)),
                          )
                        }
                      />
                      <span>to</span>
                      <input
                        type="time"
                        aria-label={`${name} until`}
                        value={r.end}
                        onChange={(e) =>
                          setRanges(
                            day,
                            ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${name} ${r.start} to ${r.end}`}
                        onClick={() => setRanges(day, ranges.filter((_, j) => j !== i))}
                      >
                        <Trash2 size={14} />
                      </button>
                      {r.end <= r.start && <small className="field-error">Ends before it starts</small>}
                    </div>
                  ))}
                  {ranges.length > 0 && (
                    <button
                      type="button"
                      className="under-link"
                      onClick={() => setRanges(day, [...ranges, { day, start: "17:00", end: "19:00" }])}
                    >
                      + Add hours
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-section">
        <div>
          <p className="eyebrow">Meetings</p>
          <h2 className="serif">How long, and how</h2>
          <p>A break between meetings gives you room to breathe and pray.</p>
        </div>
        <div className="settings-fields two-col">
          <Field label="Each meeting lasts">
            <select
              value={draft.meetingMinutes}
              onChange={(e) => setDraft({ ...draft, meetingMinutes: Number(e.target.value) })}
            >
              {[...new Set([...MEETING, draft.meetingMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Field>
          <Field label="Break between meetings">
            <select
              value={draft.bufferMinutes}
              onChange={(e) => setDraft({ ...draft, bufferMinutes: Number(e.target.value) })}
            >
              {[...new Set([...BUFFER, draft.bufferMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {m ? `${m} minutes` : "No break"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Book at least">
            <select
              value={draft.noticeHours}
              onChange={(e) => setDraft({ ...draft, noticeHours: Number(e.target.value) })}
            >
              {NOTICE.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.value ? `${n.label} ahead` : n.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Show times up to">
            <select
              value={draft.horizonDays}
              onChange={(e) => setDraft({ ...draft, horizonDays: Number(e.target.value) })}
            >
              {[...new Set([...HORIZON, draft.horizonDays])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {d} days ahead
                </option>
              ))}
            </select>
          </Field>
          <div className="field span-2">
            <span>Ways to meet</span>
            <div className="chip-row">
              {FORMATS.map((f) => {
                const on = draft.formats.includes(f.value);
                return (
                  <button
                    type="button"
                    key={f.value}
                    className={`choice-chip ${on ? "selected" : ""}`}
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? draft.formats.filter((x) => x !== f.value) : [...draft.formats, f.value];
                      if (next.length) setDraft({ ...draft, formats: next });
                    }}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Where to meet in person (optional)">
            <input
              maxLength={200}
              placeholder="e.g. Pastor's office, church building"
              value={draft.location ?? ""}
              onChange={(e) => setDraft({ ...draft, location: e.target.value || null })}
            />
          </Field>
        </div>
      </section>

      <TimeOffSection draft={draft} setDraft={setDraft} tz={tz} />

      <div className="availability-save">
        <MutationError errors={[save.error]} />
        <Button onClick={submit} disabled={save.isPending || (!dirty && initial.weekly.length > 0)}>
          {save.isPending ? "Saving…" : "Save availability"}
        </Button>
        {saved && !dirty && <span className="saved-note">Saved. People can book these times now.</span>}
      </div>

      {initial.weekly.length > 0 && slug && <Preview slug={slug} tz={tz} />}
    </div>
  );
}

function TimeOffSection({
  draft,
  setDraft,
  tz,
}: {
  draft: AvailabilityInput;
  setDraft: (d: AvailabilityInput) => void;
  tz: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [wholeDays, setWholeDays] = useState(true);
  const add = () => {
    if (!from) return;
    const startAt = wholeDays ? zonedToIso(`${from}T00:00`, tz) : zonedToIso(from, tz);
    const endLocal = to || from;
    const endAt = wholeDays
      ? new Date(new Date(zonedToIso(`${endLocal.slice(0, 10)}T00:00`, tz)).getTime() + 86400000).toISOString()
      : zonedToIso(endLocal, tz);
    if (new Date(endAt) <= new Date(startAt)) return;
    setDraft({ ...draft, timeOff: [...draft.timeOff, { startAt, endAt, label: label.trim() || null }] });
    setFrom("");
    setTo("");
    setLabel("");
  };
  const describe = (t: { startAt: string; endAt: string }) => {
    const start = new Date(t.startAt);
    const end = new Date(t.endAt);
    const midnight = zonedToIso(`${dateKey(start, tz)}T00:00`, tz) === start.toISOString();
    const fullDays = midnight && (end.getTime() - start.getTime()) % 86400000 === 0;
    if (fullDays) {
      const last = new Date(end.getTime() - 86400000);
      return dateKey(start, tz) === dateKey(last, tz)
        ? dayOf(start, tz)
        : `${shortDay(start, tz)} – ${shortDay(last, tz)}`;
    }
    return `${fmt(start, tz, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} – ${
      dateKey(start, tz) === dateKey(end, tz) ? timeOf(end, tz) : fmt(end, tz, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    }`;
  };
  return (
    <section className="settings-section">
      <div>
        <p className="eyebrow">Time off</p>
        <h2 className="serif">Block out time</h2>
        <p>Travelling, a funeral, a conference? Block the time and nobody can book it.</p>
      </div>
      <div className="settings-fields">
        {draft.timeOff.length > 0 && (
          <ul className="time-off-list">
            {draft.timeOff.map((t, i) => (
              <li key={`${t.startAt}-${i}`}>
                <span>
                  <b>{describe({ startAt: String(t.startAt), endAt: String(t.endAt) })}</b>
                  {t.label && <small>{t.label}</small>}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove time off"
                  onClick={() => setDraft({ ...draft, timeOff: draft.timeOff.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="chip-row">
          <button
            type="button"
            className={`choice-chip ${wholeDays ? "selected" : ""}`}
            onClick={() => (setWholeDays(true), setFrom(""), setTo(""))}
          >
            Whole days
          </button>
          <button
            type="button"
            className={`choice-chip ${!wholeDays ? "selected" : ""}`}
            onClick={() => (setWholeDays(false), setFrom(""), setTo(""))}
          >
            A few hours
          </button>
        </div>
        <div className="time-off-form">
          <Field label="From">
            <input type={wholeDays ? "date" : "datetime-local"} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={wholeDays ? "Until (optional)" : "Until"}>
            <input type={wholeDays ? "date" : "datetime-local"} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Reason (only you see it)">
            <input maxLength={120} placeholder="e.g. Ministers' conference" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Button variant="outline" onClick={add} disabled={!from || (!wholeDays && !to)}>
            <Plus size={14} /> Block it
          </Button>
        </div>
        {draft.timeOff.length > 0 && <small className="muted">Remember to save below.</small>}
      </div>
    </section>
  );
}

function Preview({ slug, tz }: { slug: string; tz: string }) {
  const slots = useGetPublicSlots(slug, { query: { queryKey: getGetPublicSlotsQueryKey(slug), retry: 0 } });
  const days = slots.data?.days.slice(0, 5) ?? [];
  return (
    <section className="slot-preview">
      <p className="eyebrow">What people see now</p>
      {slots.isLoading ? (
        <SkeletonRows />
      ) : slots.isError ? (
        <p className="muted">Booking is switched off, so the care page doesn't show times.</p>
      ) : days.length === 0 ? (
        <p className="muted">No open times in the coming days. Add hours or remove some time off.</p>
      ) : (
        <div className="slot-preview-days">
          {days.map((d) => (
            <div key={d.date}>
              <b>{shortDay(d.slots[0], tz)}</b>
              <span>
                {d.slots.slice(0, 6).map((s) => timeOf(s, tz)).join(" · ")}
                {d.slots.length > 6 ? ` +${d.slots.length - 6}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <a className="under-link" href={bookingUrl(slug)} target="_blank" rel="noreferrer">
        Open your booking page <ExternalLink size={12} />
      </a>
    </section>
  );
}
