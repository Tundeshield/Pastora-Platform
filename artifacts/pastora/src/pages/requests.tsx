import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardQueryKey,
  getListAppointmentsQueryKey,
  getListRequestNotesQueryKey,
  getListRequestsQueryKey,
  useAddRequestNote,
  useCreateRequest,
  useListAppointments,
  useListRequestNotes,
  useListRequests,
  useUpdateAppointment,
  useUpdateRequest,
  type Appointment,
  type PastoralRequest,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  HandHeart,
  Inbox,
  LockKeyhole,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { useAccess } from "@/access";
import { useSession } from "@/auth";
import { Badge, Button, ErrorPanel, Field, MutationError, PageHeading, SkeletonRows, formatLabel } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

/* ------------------------------------------------------------------ model */

type Kind = "prayer" | "counselling" | "question" | "guest" | "booking" | "appointment";

const KINDS: Record<Kind, { label: string; plural: string; icon: typeof HandHeart }> = {
  prayer: { label: "Prayer", plural: "Prayer", icon: HandHeart },
  counselling: { label: "Counselling", plural: "Counselling", icon: LockKeyhole },
  question: { label: "Question", plural: "Questions", icon: MessageCircle },
  guest: { label: "New guest", plural: "Guests", icon: Sparkles },
  booking: { label: "Booking", plural: "Bookings", icon: CalendarDays },
  appointment: { label: "Appointment", plural: "Appointments", icon: CalendarDays },
};

type Item = {
  key: string;
  kind: Kind;
  sender: string;
  snippet: string;
  at: string;
  unread: boolean;
  done: boolean;
  request?: PastoralRequest;
  booking?: Appointment;
};

function kindOf(r: PastoralRequest): Kind {
  if (r.type === "general") return r.category === "First-time guest" ? "guest" : "question";
  if (r.type === "appointment") return "appointment";
  return r.type as Kind;
}

function senderOf(r: PastoralRequest): string {
  if (r.anonymous) return "Anonymous";
  return r.name?.trim() || "No name given";
}

function snippetOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 110 ? `${line.slice(0, 108)}…` : line;
}

/** Email-style time: "10:15" today, "Yesterday", "Mon" this week, then "12 Oct". */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const fullWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

/* ------------------------------------------------------------------- page */

export function RequestsPage() {
  const session = useSession();
  const access = useAccess();
  const isPastor = access.isPastor;
  const enquiries = access.can("enquiries");
  const calendar = access.can("calendar");
  const prayerTeam = !isPastor && access.can("prayer");
  const [, setLocation] = useLocation();
  const openKey = new URLSearchParams(useSearch()).get("open");
  const qc = useQueryClient();
  const tz = session.data?.church?.timeZone ?? undefined;

  const requests = useListRequests(undefined, { query: { queryKey: getListRequestsQueryKey(), retry: 1 } });
  const appointments = useListAppointments({
    query: { queryKey: getListAppointmentsQueryKey(), retry: 1, enabled: calendar },
  });
  const updateRequest = useUpdateRequest();
  // Marking as read happens quietly in the background; a failure there isn't worth a warning.
  const markRead = useUpdateRequest();
  const updateBooking = useUpdateAppointment();

  const [show, setShow] = useState<"open" | "done">("open");
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const items: Item[] = useMemo(() => {
    const fromRequests: Item[] = (requests.data ?? []).map((r) => ({
      key: r.id,
      kind: kindOf(r),
      sender: senderOf(r),
      snippet: snippetOf(r.message || (r.type === "counselling" ? "Confidential request" : "")),
      at: r.createdAt,
      unread: r.status === "new",
      done: r.status === "resolved" || r.status === "closed",
      request: r,
    }));
    const now = Date.now();
    const fromBookings: Item[] = (appointments.data ?? [])
      .filter((a) => a.source === "public_portal")
      .map((a) => {
        const over = new Date(a.startAt).getTime() + a.durationMinutes * 60000 < now;
        return {
          key: `b-${a.id}`,
          kind: "booking" as const,
          sender: a.requesterName,
          snippet: `${new Date(a.startAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) })} · ${a.topic ? snippetOf(a.topic) : formatLabel(a.format)}`,
          at: a.createdAt,
          unread: a.status === "requested" && !over,
          // A booking needs you only while it waits for an answer; confirmed ones live in the calendar.
          done: over || a.status !== "requested",
          booking: a,
        };
      });
    return [...fromRequests, ...fromBookings].sort((a, b) => b.at.localeCompare(a.at));
  }, [requests.data, appointments.data, tz]);

  const counts = useMemo(() => {
    const c: Partial<Record<Kind, number>> = {};
    for (const i of items) if (!i.done) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [items]);
  const kindsPresent = (Object.keys(KINDS) as Kind[]).filter((k) => items.some((i) => i.kind === k));
  const needle = search.trim().toLowerCase();
  const visible = items.filter(
    (i) =>
      (show === "done" ? i.done : !i.done) &&
      (filter === "all" || i.kind === filter) &&
      (!needle || `${i.sender} ${i.snippet} ${i.request?.message ?? ""}`.toLowerCase().includes(needle)),
  );
  const selected = items.find((i) => i.key === openKey) ?? null;
  const open = (key: string | null) => setLocation(key ? `/app/requests?open=${key}` : "/app/requests", { replace: !!openKey });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getListRequestsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const canUpdate = (r: PastoralRequest) => isPastor || (enquiries && r.type === "general");
  const setStatus = (r: PastoralRequest, status: PastoralRequest["status"]) =>
    updateRequest.mutate({ requestId: r.id, data: { status } }, { onSuccess: refresh });

  // Opening a new message marks it read, like email.
  useEffect(() => {
    const r = selected?.request;
    if (r && r.status === "new" && canUpdate(r))
      markRead.mutate({ requestId: r.id, data: { status: "acknowledged" } }, { onSuccess: refresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key]);

  const loading = requests.isLoading || (calendar && appointments.isLoading);
  const title = isPastor || (enquiries && prayerTeam) ? "Care inbox" : enquiries ? "Enquiries" : "Prayer requests";
  const unreadCount = items.filter((i) => i.unread).length;

  return (
    <>
      <PageHeading
        eyebrow={isPastor ? "Private care" : prayerTeam ? "Prayer team" : "Church office"}
        title={title}
        subtitle={
          unreadCount
            ? `${unreadCount} new ${unreadCount === 1 ? "message" : "messages"} waiting for you.`
            : "You're all caught up."
        }
        action={
          isPastor || enquiries ? (
            <Button variant="outline" onClick={() => setAdding(!adding)}>
              <Plus size={15} /> Record a request
            </Button>
          ) : undefined
        }
      />
      {adding && <NewRequestForm isPastor={isPastor} onDone={() => (setAdding(false), refresh())} />}
      <MutationError errors={[updateRequest.error, updateBooking.error]} />

      {requests.isError ? (
        <ErrorPanel
          text={apiErrorMessage(requests.error, "The inbox is unavailable.")}
          retry={() => void requests.refetch()}
        />
      ) : (
        <div className={`inbox ${selected ? "has-selection" : ""}`}>
          <div className="inbox-list-pane">
            <div className="inbox-tools">
              <div className="inbox-tabs" role="tablist">
                <button role="tab" aria-selected={show === "open"} onClick={() => setShow("open")}>
                  To do
                </button>
                <button role="tab" aria-selected={show === "done"} onClick={() => setShow("done")}>
                  Done
                </button>
              </div>
              <label className="inbox-search">
                <Search size={14} />
                <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            </div>
            {kindsPresent.length > 1 && (
              <div className="inbox-filters">
                <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
                  All
                </button>
                {kindsPresent.map((k) => (
                  <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
                    {KINDS[k].plural}
                    {counts[k] ? <small>{counts[k]}</small> : null}
                  </button>
                ))}
              </div>
            )}
            {loading ? (
              <SkeletonRows />
            ) : visible.length ? (
              <ul className="inbox-list">
                {visible.map((i) => {
                  const Icon = KINDS[i.kind].icon;
                  return (
                    <li key={i.key}>
                      <button
                        className={`inbox-row ${i.unread ? "unread" : ""} ${selected?.key === i.key ? "selected" : ""}`}
                        onClick={() => open(i.key)}
                      >
                        <span className={`inbox-icon kind-${i.kind}`}>
                          <Icon size={16} />
                        </span>
                        <span className="inbox-row-main">
                          <span className="inbox-row-top">
                            <b>{i.sender}</b>
                            <time>{shortWhen(i.at)}</time>
                          </span>
                          <span className="inbox-row-kind">{KINDS[i.kind].label}</span>
                          <span className="inbox-row-snippet">{i.snippet}</span>
                        </span>
                        {i.unread && <i className="inbox-dot" aria-label="New" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="inbox-empty">
                <Inbox size={22} />
                <b>{show === "done" ? "Nothing finished yet" : "Nothing waiting"}</b>
                <small>
                  {show === "done"
                    ? "Messages you mark as done move here."
                    : "New prayer requests, questions, guests and bookings appear here."}
                </small>
              </div>
            )}
          </div>

          <div className="inbox-detail-pane">
            {selected ? (
              <>
                <button className="inbox-back" onClick={() => open(null)}>
                  <ArrowLeft size={15} /> Inbox
                </button>
                {selected.request ? (
                  <RequestDetail
                    r={selected.request}
                    kind={selected.kind}
                    canUpdate={canUpdate(selected.request)}
                    isPastor={isPastor}
                    prayerTeam={prayerTeam}
                    onStatus={(s) => setStatus(selected.request!, s)}
                    onNextStep={(nextAction) =>
                      updateRequest.mutate(
                        { requestId: selected.request!.id, data: { nextAction } },
                        { onSuccess: refresh },
                      )
                    }
                  />
                ) : selected.booking ? (
                  <BookingDetail
                    a={selected.booking}
                    tz={tz}
                    onStatus={(status) =>
                      updateBooking.mutate(
                        { appointmentId: selected.booking!.id, data: { status } },
                        { onSuccess: refresh },
                      )
                    }
                  />
                ) : null}
              </>
            ) : (
              <div className="inbox-placeholder">
                <Mail size={26} />
                <p>Choose a message to read it.</p>
                <small>
                  {isPastor
                    ? "Counselling and your private notes are seen by pastors only."
                    : prayerTeam
                      ? "You see prayer requests people chose to share, never their contact details."
                      : "Prayer and counselling requests go to your pastors only."}
                </small>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- detail */

function ContactLine({ contact, ok }: { contact: string; ok: boolean }) {
  const isEmail = contact.includes("@");
  const href = isEmail ? `mailto:${contact}` : `tel:${contact.replace(/[^\d+]/g, "")}`;
  return (
    <div className="inbox-contact">
      {isEmail ? <Mail size={15} /> : <Phone size={15} />}
      <a href={href}>{contact}</a>
      <small>{ok ? "Happy to be contacted" : "Didn't ask to be contacted"}</small>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inbox-fact">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

function RequestDetail({
  r,
  kind,
  canUpdate,
  isPastor,
  prayerTeam,
  onStatus,
  onNextStep,
}: {
  r: PastoralRequest;
  kind: Kind;
  canUpdate: boolean;
  isPastor: boolean;
  prayerTeam: boolean;
  onStatus: (s: PastoralRequest["status"]) => void;
  onNextStep: (s: string | null) => void;
}) {
  const [next, setNext] = useState(r.nextAction ?? "");
  useEffect(() => setNext(r.nextAction ?? ""), [r.id, r.nextAction]);
  const done = r.status === "resolved" || r.status === "closed";
  const Icon = KINDS[kind].icon;
  return (
    <article className="inbox-detail">
      <header>
        <span className={`inbox-kind-pill kind-${kind}`}>
          <Icon size={13} /> {KINDS[kind].label}
        </span>
        <Badge label={r.status} />
      </header>
      <h2 className="serif">{senderOf(r)}</h2>
      <p className="inbox-when">{fullWhen(r.createdAt)}</p>
      {r.contact && !prayerTeam && <ContactLine contact={r.contact} ok={r.permissionToContact} />}

      <div className="inbox-message">{r.message || <em>No message.</em>}</div>

      <div className="inbox-facts">
        {r.category && kind !== "guest" && <Fact label="Category">{r.category}</Fact>}
        {r.campaign && <Fact label="Came through">{r.campaign}</Fact>}
        {r.preferredFormat && <Fact label="Would like to meet">{formatLabel(r.preferredFormat)}</Fact>}
        {r.preferredAvailability && <Fact label="Usually free">{r.preferredAvailability}</Fact>}
        {r.type === "prayer" && isPastor && (
          <Fact label="Prayer team">{r.shareWithPrayerTeam ? "Shared with the prayer team" : "For pastors only"}</Fact>
        )}
      </div>

      {canUpdate && (
        <div className="inbox-actions">
          {done ? (
            <Button variant="outline" onClick={() => onStatus("acknowledged")}>
              <RotateCcw size={15} /> Move back to To do
            </Button>
          ) : (
            <Button onClick={() => onStatus("resolved")}>
              <Check size={15} /> Mark as done
            </Button>
          )}
          <form
            className="inbox-next"
            onSubmit={(e) => {
              e.preventDefault();
              onNextStep(next.trim() || null);
            }}
          >
            <input
              aria-label="Next step"
              placeholder="Next step, e.g. Call on Thursday"
              maxLength={300}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            {next !== (r.nextAction ?? "") && (
              <button type="submit" aria-label="Save next step">
                <ArrowRight size={15} />
              </button>
            )}
          </form>
        </div>
      )}

      {isPastor && <PrivateNotes requestId={r.id} />}
    </article>
  );
}

function PrivateNotes({ requestId }: { requestId: string }) {
  const notes = useListRequestNotes(requestId, { query: { queryKey: getListRequestNotesQueryKey(requestId), retry: 1 } });
  const add = useAddRequestNote();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  return (
    <section className="inbox-notes">
      <h3>
        <LockKeyhole size={14} /> Private notes <small>Only pastors see these</small>
      </h3>
      {notes.data?.map((n) => (
        <div className="inbox-note" key={n.id}>
          <p>{n.note}</p>
          <small>
            {n.authorName ? `${n.authorName} · ` : ""}
            {shortWhen(n.createdAt)}
          </small>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          add.mutate(
            { requestId, data: { note: note.trim() } },
            {
              onSuccess: () => {
                setNote("");
                void qc.invalidateQueries({ queryKey: getListRequestNotesQueryKey(requestId) });
              },
            },
          );
        }}
      >
        <textarea
          aria-label="Add a private note"
          placeholder="Add a note for yourself or other pastors…"
          maxLength={5000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!note.trim() || add.isPending}>
          Save note
        </Button>
      </form>
      <MutationError errors={[add.error]} />
    </section>
  );
}

function BookingDetail({
  a,
  tz,
  onStatus,
}: {
  a: Appointment;
  tz?: string;
  onStatus: (s: Appointment["status"]) => void;
}) {
  const start = new Date(a.startAt);
  const end = new Date(start.getTime() + a.durationMinutes * 60000);
  const opts = (o: Intl.DateTimeFormatOptions) => ({ ...o, ...(tz ? { timeZone: tz } : {}) });
  const when = `${start.toLocaleDateString(undefined, opts({ weekday: "long", day: "numeric", month: "long" }))}, ${start.toLocaleTimeString(undefined, opts({ hour: "numeric", minute: "2-digit" }))} – ${end.toLocaleTimeString(undefined, opts({ hour: "numeric", minute: "2-digit" }))}`;
  return (
    <article className="inbox-detail">
      <header>
        <span className="inbox-kind-pill kind-booking">
          <CalendarDays size={13} /> Booking
        </span>
        <Badge label={a.status} />
      </header>
      <h2 className="serif">{a.requesterName}</h2>
      <p className="inbox-when">Booked {fullWhen(a.createdAt)}</p>
      {a.contact && <ContactLine contact={a.contact} ok />}
      <div className="inbox-booking-when">
        <CalendarDays size={18} />
        <span>
          <b>{when}</b>
          <small>{formatLabel(a.format)}</small>
        </span>
      </div>
      {a.topic && <div className="inbox-message">{a.topic}</div>}
      <div className="inbox-actions">
        {a.status === "requested" && (
          <>
            <Button onClick={() => onStatus("confirmed")}>
              <Check size={15} /> Confirm this time
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                if (window.confirm(`Decline ${a.requesterName}'s request? The time opens up again.`)) onStatus("declined");
              }}
            >
              <X size={15} /> Decline
            </Button>
          </>
        )}
        <Link href="/app/appointments" className="under-link">
          Open appointments <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------- new request */

function NewRequestForm({ isPastor, onDone }: { isPastor: boolean; onDone: () => void }) {
  const create = useCreateRequest();
  const [form, setForm] = useState({
    type: isPastor ? "prayer" : "general",
    name: "",
    contact: "",
    category: "",
    message: "",
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { data: { ...form, type: form.type as "prayer" | "counselling" | "appointment" | "general" } },
      { onSuccess: onDone },
    );
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      <p className="settings-note" style={{ gridColumn: "1 / -1" }}>
        For a request someone gave you in person or on the phone, so it isn’t forgotten.
      </p>
      {isPastor && (
        <Field label="Type">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="prayer">Prayer</option>
            <option value="counselling">Counselling</option>
            <option value="general">Question</option>
          </select>
        </Field>
      )}
      <Field label="Name (optional)">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Phone or email (optional)">
        <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
      </Field>
      <Field label="Details">
        <textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </Field>
      <MutationError errors={[create.error]} />
      <div className="form-actions">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
