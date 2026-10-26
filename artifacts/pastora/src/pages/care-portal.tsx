import {
  getGetPublicChurchQueryKey,
  getGetPublicLinkQueryKey,
  getGetPublicSlotsQueryKey,
  recordQrVisit,
  useGetPublicChurch,
  useGetPublicLink,
  useGetPublicSlots,
  useSubmitPublicRequest,
  type PublicChurch,
  type PublicSlots,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CheckCheck,
  CircleHelp,
  HandHeart,
  HeartHandshake,
  LockKeyhole,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useParams, useSearch } from "wouter";

import { Button, Field, Footer, Header, SkeletonRows, StatusLine, Toggle } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";
import { churchLink } from "@/site";
import { dayOf, fmt, icsFile, shortDay, timeOf, zoneName } from "@/zoned";

type Flow = "choose" | "prayer" | "counselling" | "appointment" | "general" | "welcome";
type Format = "in-person" | "phone" | "video";
const FLOWS: Flow[] = ["prayer", "counselling", "appointment", "general", "welcome"];

/** QR destinations map onto the page each one opens. */
const FROM_DESTINATION: Record<string, Flow> = {
  care: "choose",
  prayer: "prayer",
  counselling: "counselling",
  appointments: "appointment",
  general: "general",
  welcome: "welcome",
};

const FORMAT_LABEL: Record<Format, string> = { "in-person": "In person", phone: "Phone call", video: "Video call" };

const HEADINGS: Record<Exclude<Flow, "choose">, { title: string; intro: string }> = {
  prayer: {
    title: "How can we pray for you?",
    intro: "Share as much or as little as you like. You can stay anonymous.",
  },
  counselling: {
    title: "Talk to someone in confidence.",
    intro: "Only the pastoral team sees this. We'll get in touch to arrange a conversation.",
  },
  appointment: { title: "Book a time to talk.", intro: "Choose a time that suits you." },
  general: { title: "Ask us anything.", intro: "Service times, events, how to get involved — we'll get back to you." },
  welcome: {
    title: "We're so glad you came.",
    intro: "Tell us a little about yourself so we can welcome you properly.",
  },
};

/** A datetime-local value for one hour from now, used as the earliest selectable time. */
function minDateTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** The church's care page, at /care/<church> or at the church's own address. */
export function CarePortalPage({ slug: slugProp }: { slug?: string } = {}) {
  const params0 = useParams<{ slug?: string }>();
  const slug = slugProp ?? params0.slug ?? "";
  const params = new URLSearchParams(useSearch());
  const requestedType = params.get("type") as Flow | null;
  const qrCodeId = params.get("qr");
  const church = useGetPublicChurch(slug, {
    query: { queryKey: getGetPublicChurchQueryKey(slug), retry: 1 },
  });
  const link = useGetPublicLink(slug, qrCodeId ?? "", {
    query: { queryKey: getGetPublicLinkQueryKey(slug, qrCodeId ?? ""), enabled: Boolean(qrCodeId), retry: 0 },
  });
  const linkFlow = link.data ? FROM_DESTINATION[link.data.destination] : undefined;
  const startFlow: Flow = linkFlow ?? (requestedType && FLOWS.includes(requestedType) ? requestedType : "choose");
  const [chosen, setChosen] = useState<Flow | null>(null);
  const flow = chosen ?? startFlow;
  const [done, setDone] = useState<ReactNode>(null);

  // Count a QR scan once per browser session. Nothing personal is sent.
  useEffect(() => {
    if (!qrCodeId) return;
    const key = `pastora-qr-${qrCodeId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage may be unavailable; counting once per page view is fine.
    }
    void recordQrVisit(qrCodeId).catch(() => undefined);
  }, [qrCodeId]);

  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [flow, done]);

  // The link's own words apply to the page it was made for.
  const custom = link.data && flow === startFlow ? link.data : null;
  const choose = (next: Flow) => {
    setDone(null);
    setChosen(next);
  };
  const waiting = church.isLoading || (Boolean(qrCodeId) && link.isLoading);

  return (
    <div className="public-shell care-portal grain">
      <Header />
      <main className="portal-main">
        {waiting ? (
          <SkeletonRows />
        ) : church.isError || !church.data ? (
          <div className="portal-error">
            <HeartHandshake />
            <h1 className="serif">This care page is unavailable.</h1>
            <p>The church link may be incorrect or its public portal may not be enabled.</p>
          </div>
        ) : (
          <>
            <div className="portal-welcome">
              <span className="portal-seal">
                <HeartHandshake size={24} />
              </span>
              <p className="eyebrow">{church.data.name}</p>
              <h1 className="serif">
                You don't have to
                <br />
                <em>carry it alone.</em>
              </h1>
              <p>{church.data.welcomeMessage}</p>
              {church.data.emergencyNotice && (
                <div className="emergency-note">
                  <CircleHelp size={17} />
                  {church.data.emergencyNotice}
                </div>
              )}
              {church.data.blogEnabled && (
                <a className="under-link portal-blog-link" href={churchLink(church.data.slug, { page: "blog" })}>
                  Read the pastor's blog <ArrowRight size={14} />
                </a>
              )}
            </div>
            <div className="portal-side">
              {flow !== "choose" && !done && (
                <button className="portal-back" onClick={() => choose("choose")}>
                  <ArrowLeft size={14} /> Other ways we can help
                </button>
              )}
              {done ? (
                <div className="receipt-success">
                  {done}
                  <Button variant="outline" onClick={() => choose("choose")}>
                    Back to the care page
                  </Button>
                </div>
              ) : flow === "choose" ? (
                <Chooser church={church.data} onChoose={choose} heading={custom?.headline} intro={custom?.message} />
              ) : flow === "appointment" ? (
                <BookingFlow
                  church={church.data}
                  slug={slug}
                  qrCodeId={qrCodeId}
                  heading={custom?.headline}
                  intro={custom?.message}
                  onDone={setDone}
                  onOther={() => choose("general")}
                />
              ) : flow === "welcome" ? (
                <WelcomeForm slug={slug} qrCodeId={qrCodeId} heading={custom?.headline} intro={custom?.message} onDone={setDone} />
              ) : (
                <MessageForm
                  key={flow}
                  type={flow}
                  church={church.data}
                  slug={slug}
                  qrCodeId={qrCodeId}
                  heading={custom?.headline}
                  intro={custom?.message}
                  onDone={setDone}
                />
              )}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ chooser */

function Chooser({
  church,
  onChoose,
  heading,
  intro,
}: {
  church: PublicChurch;
  onChoose: (flow: Flow) => void;
  heading?: string | null;
  intro?: string | null;
}) {
  const options: { flow: Flow; icon: ReactNode; title: string; text: string; show: boolean }[] = [
    {
      flow: "prayer",
      icon: <HandHeart size={20} />,
      title: "Ask for prayer",
      text: "Share what's on your heart. You can stay anonymous.",
      show: true,
    },
    {
      flow: "appointment",
      icon: <CalendarDays size={20} />,
      title: "Book time with the pastor",
      text:
        church.bookingMode === "slots"
          ? "Pick an open time that suits you."
          : "Suggest a time and the church will confirm it.",
      show: church.bookingMode !== "off",
    },
    {
      flow: "counselling",
      icon: <LockKeyhole size={20} />,
      title: "Talk to someone in confidence",
      text: "Private, and seen only by the pastoral team.",
      show: true,
    },
    {
      flow: "general",
      icon: <MessageCircle size={20} />,
      title: "Ask a question",
      text: "Service times, events, getting involved.",
      show: true,
    },
    {
      flow: "welcome",
      icon: <Sparkles size={20} />,
      title: "I'm new here",
      text: "Say hello so we can welcome you properly.",
      show: true,
    },
  ];
  return (
    <div className="portal-chooser">
      <p className="eyebrow">Reach out</p>
      <h2 className="serif">{heading || "How can we help?"}</h2>
      {intro && <p className="portal-intro">{intro}</p>}
      <div className="choice-cards">
        {options
          .filter((o) => o.show)
          .map((o) => (
            <button key={o.flow} className="choice-card" onClick={() => onChoose(o.flow)}>
              <span className="choice-icon">{o.icon}</span>
              <span>
                <b>{o.title}</b>
                <small>{o.text}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
      </div>
      <PrivacyNote />
    </div>
  );
}

function PrivacyNote() {
  return (
    <small className="privacy-reminder">
      <LockKeyhole size={13} />
      <span>
        Your message is handled by the church. Only share what you feel comfortable sharing.{" "}
        <a href="/privacy">Privacy</a>
      </span>
    </small>
  );
}

function FormHeading({ flow, heading, intro }: { flow: Exclude<Flow, "choose">; heading?: string | null; intro?: string | null }) {
  return (
    <>
      <h2 className="serif">{heading || HEADINGS[flow].title}</h2>
      <p className="portal-intro">{intro || HEADINGS[flow].intro}</p>
    </>
  );
}

function Received({ reference, title, children }: { reference: string; title: string; children?: ReactNode }) {
  return (
    <>
      <CheckCheck />
      <p className="eyebrow">Received</p>
      <h2 className="serif">{title}</h2>
      {children}
      <p>
        Your reference is <b>{reference}</b>.
      </p>
    </>
  );
}

/* ------------------------------------------------------- prayer & messages */

function MessageForm({
  type,
  church,
  slug,
  qrCodeId,
  heading,
  intro,
  onDone,
  requestTime = false,
}: {
  type: "prayer" | "counselling" | "general" | "appointment";
  church: PublicChurch;
  slug: string;
  qrCodeId: string | null;
  heading?: string | null;
  intro?: string | null;
  onDone: (node: ReactNode) => void;
  requestTime?: boolean;
}) {
  const submit = useSubmitPublicRequest();
  const [form, setForm] = useState({
    name: "",
    anonymous: false,
    contact: "",
    category: "",
    message: "",
    permissionToContact: type === "counselling" || type === "appointment",
    shareWithPrayerTeam: false,
    preferredDate: "",
    preferredFormat: "in-person" as Format,
    preferredAvailability: "",
  });
  const isAppointment = type === "appointment";
  const send = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate(
      {
        slug,
        data: {
          type,
          anonymous: form.anonymous,
          message: form.message.trim(),
          permissionToContact: form.permissionToContact,
          shareWithPrayerTeam: type === "prayer" && form.shareWithPrayerTeam,
          name: form.anonymous ? null : form.name.trim() || null,
          contact: form.contact.trim() || null,
          category: form.category || null,
          preferredFormat: isAppointment || type === "counselling" ? form.preferredFormat : null,
          preferredAvailability: type === "counselling" ? form.preferredAvailability.trim() || null : null,
          preferredDate: isAppointment && form.preferredDate ? new Date(form.preferredDate).toISOString() : null,
          campaign: null,
          qrCodeId: qrCodeId || null,
        },
      },
      {
        onSuccess: (r) =>
          onDone(
            <Received
              reference={r.reference}
              title={
                type === "prayer"
                  ? "Thank you. We're praying with you."
                  : isAppointment
                    ? "Your request has been sent."
                    : "Thank you for reaching out."
              }
            >
              <p>
                {isAppointment
                  ? "The church will confirm your time or suggest another."
                  : form.permissionToContact && form.contact
                    ? "Someone from the church will be in touch."
                    : "Your message has reached the church."}
              </p>
            </Received>,
          ),
      },
    );
  };
  const asksName = !form.anonymous && type !== "counselling";
  return (
    <form className="portal-form" onSubmit={send}>
      <FormHeading flow={type} heading={heading} intro={intro} />
      {church.categories.length > 0 && type !== "appointment" && (
        <Field label="Category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Choose, if helpful</option>
            {church.categories.map((c) => (
              <option value={c} key={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field
        label={
          type === "prayer"
            ? "Your prayer request"
            : isAppointment
              ? "What would you like to talk about?"
              : type === "counselling"
                ? "What would you like to talk about?"
                : "Your question or message"
        }
      >
        <textarea
          required
          maxLength={5000}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
      </Field>
      {type !== "counselling" && !isAppointment && (
        <Toggle
          label="Keep me anonymous"
          value={form.anonymous}
          onChange={(v) => setForm({ ...form, anonymous: v })}
        />
      )}
      {(asksName || type === "counselling") && (
        <Field label={isAppointment ? "Your name" : "Your name (optional)"}>
          <input
            required={isAppointment}
            maxLength={120}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
      )}
      {!form.anonymous && (
        <Field label={isAppointment || type === "counselling" ? "Phone or email" : "Phone or email (optional)"}>
          <input
            required={isAppointment || type === "counselling"}
            maxLength={200}
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
          />
        </Field>
      )}
      {requestTime && (
        <>
          <Field label="Preferred date and time">
            <input
              required
              type="datetime-local"
              min={minDateTime()}
              value={form.preferredDate}
              onChange={(e) => setForm({ ...form, preferredDate: e.target.value })}
            />
          </Field>
          <p className="portal-hint">The church will confirm or suggest another time.</p>
        </>
      )}
      {(isAppointment || type === "counselling") && (
        <Field label="Preferred way to meet">
          <select
            value={form.preferredFormat}
            onChange={(e) => setForm({ ...form, preferredFormat: e.target.value as Format })}
          >
            <option value="in-person">In person</option>
            <option value="phone">Phone call</option>
            <option value="video">Video call</option>
          </select>
        </Field>
      )}
      {type === "counselling" && (
        <Field label="When are you usually free? (optional)">
          <input
            maxLength={500}
            placeholder="e.g. weekday evenings"
            value={form.preferredAvailability}
            onChange={(e) => setForm({ ...form, preferredAvailability: e.target.value })}
          />
        </Field>
      )}
      {type === "prayer" && (
        <Toggle
          label="Share with the prayer team (they never see your contact details)"
          value={form.shareWithPrayerTeam}
          onChange={(v) => setForm({ ...form, shareWithPrayerTeam: v })}
        />
      )}
      {!form.anonymous && type !== "appointment" && (
        <Toggle
          label={type === "counselling" ? "It's okay to contact me (needed to arrange a conversation)" : "It's okay to contact me"}
          value={form.permissionToContact}
          onChange={(v) => setForm({ ...form, permissionToContact: v })}
        />
      )}
      <Button type="submit" disabled={submit.isPending || (type === "counselling" && !form.permissionToContact)}>
        {submit.isPending ? "Sending…" : type === "prayer" ? "Send prayer request" : "Send"} <ArrowRight size={15} />
      </Button>
      {submit.isError && (
        <StatusLine error>{apiErrorMessage(submit.error, "Your message was not sent. Please try again.")}</StatusLine>
      )}
      <PrivacyNote />
    </form>
  );
}

/* ------------------------------------------------------------------ welcome */

const HEARD = ["A friend or family member", "Social media", "Walking or driving past", "An online search", "An event", "Other"];
const INTERESTS = [
  "A call or visit from a pastor",
  "Joining a small group",
  "Serving in a team",
  "Becoming a member",
  "Prayer",
];

function WelcomeForm({
  slug,
  qrCodeId,
  heading,
  intro,
  onDone,
}: {
  slug: string;
  qrCodeId: string | null;
  heading?: string | null;
  intro?: string | null;
  onDone: (node: ReactNode) => void;
}) {
  const submit = useSubmitPublicRequest();
  const [form, setForm] = useState({ name: "", contact: "", heard: "", interests: [] as string[], note: "", okToContact: true });
  const send = (e: FormEvent) => {
    e.preventDefault();
    const lines = [
      "First visit.",
      form.heard ? `Heard about us through: ${form.heard}` : "",
      form.interests.length ? `Would like: ${form.interests.join(", ")}` : "",
      form.note.trim() ? `Note: ${form.note.trim()}` : "",
    ].filter(Boolean);
    submit.mutate(
      {
        slug,
        data: {
          type: "general",
          category: "First-time guest",
          anonymous: false,
          name: form.name.trim(),
          contact: form.contact.trim() || null,
          message: lines.join("\n"),
          permissionToContact: form.okToContact && Boolean(form.contact.trim()),
          shareWithPrayerTeam: false,
          campaign: null,
          qrCodeId: qrCodeId || null,
        },
      },
      {
        onSuccess: (r) =>
          onDone(
            <Received reference={r.reference} title={`Welcome, ${form.name.trim().split(" ")[0]}!`}>
              <p>Thank you for telling us about yourself. We hope to see you again soon.</p>
            </Received>,
          ),
      },
    );
  };
  const toggle = (item: string) =>
    setForm({
      ...form,
      interests: form.interests.includes(item) ? form.interests.filter((i) => i !== item) : [...form.interests, item],
    });
  return (
    <form className="portal-form" onSubmit={send}>
      <FormHeading flow="welcome" heading={heading} intro={intro} />
      <Field label="Your name">
        <input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Phone or email (optional)">
        <input maxLength={200} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
      </Field>
      <Field label="How did you hear about us?">
        <select value={form.heard} onChange={(e) => setForm({ ...form, heard: e.target.value })}>
          <option value="">Choose one</option>
          {HEARD.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span>I'd like (choose any)</span>
        <div className="chip-row">
          {INTERESTS.map((i) => (
            <button
              type="button"
              key={i}
              aria-pressed={form.interests.includes(i)}
              className={`choice-chip ${form.interests.includes(i) ? "selected" : ""}`}
              onClick={() => toggle(i)}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      <Field label="Anything else? (optional)">
        <textarea maxLength={1500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      {form.contact.trim() && (
        <Toggle label="It's okay to contact me" value={form.okToContact} onChange={(v) => setForm({ ...form, okToContact: v })} />
      )}
      <Button type="submit" disabled={submit.isPending}>
        {submit.isPending ? "Sending…" : "Say hello"} <ArrowRight size={15} />
      </Button>
      {submit.isError && (
        <StatusLine error>{apiErrorMessage(submit.error, "This wasn't sent. Please try again.")}</StatusLine>
      )}
      <PrivacyNote />
    </form>
  );
}

/* ------------------------------------------------------------------ booking */

function BookingFlow({
  church,
  slug,
  qrCodeId,
  heading,
  intro,
  onDone,
  onOther,
}: {
  church: PublicChurch;
  slug: string;
  qrCodeId: string | null;
  heading?: string | null;
  intro?: string | null;
  onDone: (node: ReactNode) => void;
  onOther: () => void;
}) {
  if (church.bookingMode === "off") {
    return (
      <div className="portal-form">
        <FormHeading flow="appointment" heading={heading} />
        <p className="portal-intro">Online booking isn't open right now. Send the church a message and they'll find a time with you.</p>
        <Button onClick={onOther}>
          Send a message <ArrowRight size={15} />
        </Button>
      </div>
    );
  }
  if (church.bookingMode === "request") {
    return (
      <MessageForm
        type="appointment"
        requestTime
        church={church}
        slug={slug}
        qrCodeId={qrCodeId}
        heading={heading}
        intro={intro || "Suggest a time and the church will confirm it."}
        onDone={onDone}
      />
    );
  }
  return <SlotBooking slug={slug} qrCodeId={qrCodeId} heading={heading} intro={intro} onDone={onDone} onOther={onOther} />;
}

function SlotBooking({
  slug,
  qrCodeId,
  heading,
  intro,
  onDone,
  onOther,
}: {
  slug: string;
  qrCodeId: string | null;
  heading?: string | null;
  intro?: string | null;
  onDone: (node: ReactNode) => void;
  onOther: () => void;
}) {
  const slots = useGetPublicSlots(slug, { query: { queryKey: getGetPublicSlotsQueryKey(slug), retry: 1 } });
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const days = slots.data?.days ?? [];
  const activeDay = days.find((d) => d.date === day) ?? days[0];

  if (slots.isLoading) return <SkeletonRows />;
  if (slots.isError || !slots.data) {
    return (
      <div className="portal-form">
        <FormHeading flow="appointment" heading={heading} />
        <p className="portal-intro">Open times couldn't be loaded. Please try again, or send the church a message.</p>
        <Button variant="outline" onClick={() => void slots.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const data = slots.data;
  const tz = data.timeZone;
  if (slot) {
    return (
      <BookingDetails
        slug={slug}
        qrCodeId={qrCodeId}
        data={data}
        slot={slot}
        onBack={() => setSlot(null)}
        onTaken={() => {
          setSlot(null);
          void slots.refetch();
        }}
        onDone={onDone}
      />
    );
  }
  return (
    <div className="portal-form booking">
      <FormHeading flow="appointment" heading={heading} intro={intro} />
      <p className="booking-facts">
        <span>{data.meetingMinutes} minutes</span>
        <span>{data.formats.map((f) => FORMAT_LABEL[f]).join(" · ")}</span>
      </p>
      {days.length === 0 ? (
        <div className="booking-empty">
          <p>There are no open times in the coming days.</p>
          <Button variant="outline" onClick={onOther}>
            Send a message instead
          </Button>
        </div>
      ) : (
        <>
          <div className="date-strip" role="listbox" aria-label="Choose a day">
            {days.map((d) => {
              const first = d.slots[0];
              const selected = activeDay?.date === d.date;
              return (
                <button
                  key={d.date}
                  role="option"
                  aria-selected={selected}
                  className={`date-pill ${selected ? "selected" : ""}`}
                  onClick={() => setDay(d.date)}
                >
                  <small>{fmt(first, tz, { weekday: "short" })}</small>
                  <b>{fmt(first, tz, { day: "numeric" })}</b>
                  <small>{fmt(first, tz, { month: "short" })}</small>
                </button>
              );
            })}
          </div>
          {activeDay && (
            <>
              <h3 className="slot-day">{dayOf(activeDay.slots[0], tz)}</h3>
              <div className="slot-grid">
                {activeDay.slots.map((s) => (
                  <button key={s} className="slot" onClick={() => setSlot(s)}>
                    {timeOf(s, tz)}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="portal-hint">Times are in {zoneName(tz)}.</p>
        </>
      )}
      <PrivacyNote />
    </div>
  );
}

function BookingDetails({
  slug,
  qrCodeId,
  data,
  slot,
  onBack,
  onTaken,
  onDone,
}: {
  slug: string;
  qrCodeId: string | null;
  data: PublicSlots;
  slot: string;
  onBack: () => void;
  onTaken: () => void;
  onDone: (node: ReactNode) => void;
}) {
  const submit = useSubmitPublicRequest();
  const tz = data.timeZone;
  const [form, setForm] = useState({
    name: "",
    contact: "",
    message: "",
    format: (data.formats[0] ?? "in-person") as Format,
  });
  const end = useMemo(() => new Date(slot).getTime() + data.meetingMinutes * 60000, [slot, data.meetingMinutes]);
  const when = `${dayOf(slot, tz)}, ${timeOf(slot, tz)} – ${timeOf(end, tz)}`;
  const send = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate(
      {
        slug,
        data: {
          type: "appointment",
          anonymous: false,
          name: form.name.trim(),
          contact: form.contact.trim(),
          message: form.message.trim(),
          permissionToContact: true,
          shareWithPrayerTeam: false,
          preferredDate: slot,
          preferredFormat: form.format,
          campaign: null,
          qrCodeId: qrCodeId || null,
        },
      },
      {
        onSuccess: (r) => {
          const confirmed = r.appointmentStatus === "confirmed";
          onDone(
            <Received reference={r.reference} title={confirmed ? "You're booked." : "Your request is in."}>
              <div className="booking-summary">
                <b>{when}</b>
                <span>
                  {FORMAT_LABEL[form.format]}
                  {form.format === "in-person" && data.location ? ` · ${data.location}` : ""}
                </span>
              </div>
              <p>
                {confirmed
                  ? form.format === "in-person"
                    ? "We look forward to seeing you."
                    : "The church will reach you on the details you gave at that time."
                  : "This time is held for you. The church will confirm it shortly."}
              </p>
              {confirmed && (
                <a
                  className="button outline"
                  download="pastora-booking.ics"
                  href={icsFile({
                    start: slot,
                    minutes: data.meetingMinutes,
                    title: "Conversation with the pastor",
                    location: form.format === "in-person" ? data.location : FORMAT_LABEL[form.format],
                  })}
                >
                  <CalendarPlus size={15} /> Add to my calendar
                </a>
              )}
            </Received>,
          );
        },
      },
    );
  };
  const taken = submit.isError && (submit.error as { status?: number })?.status === 409;
  return (
    <form className="portal-form booking" onSubmit={send}>
      <button type="button" className="portal-back inline" onClick={onBack}>
        <ArrowLeft size={14} /> Choose another time
      </button>
      <div className="booking-summary">
        <CalendarDays size={18} />
        <span>
          <b>{when}</b>
          <small>
            {data.meetingMinutes} minutes · {shortDay(slot, tz)} · {zoneName(tz)}
          </small>
        </span>
      </div>
      <Field label="Your name">
        <input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Phone or email">
        <input required maxLength={200} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
      </Field>
      {data.formats.length > 1 && (
        <div className="field">
          <span>How would you like to meet?</span>
          <div className="chip-row">
            {data.formats.map((f) => (
              <button
                type="button"
                key={f}
                aria-pressed={form.format === f}
                className={`choice-chip ${form.format === f ? "selected" : ""}`}
                onClick={() => setForm({ ...form, format: f })}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
      )}
      {form.format === "in-person" && data.location && <p className="portal-hint">Where: {data.location}</p>}
      <Field label="What would you like to talk about?">
        <textarea
          required
          maxLength={2000}
          placeholder="A sentence is enough."
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
      </Field>
      <Button type="submit" disabled={submit.isPending}>
        {submit.isPending ? "Booking…" : data.autoConfirm ? "Confirm booking" : "Request this time"} <ArrowRight size={15} />
      </Button>
      {submit.isError && (
        <StatusLine error>
          {apiErrorMessage(submit.error, "This wasn't booked. Please try again.")}{" "}
          {taken && (
            <button type="button" className="under-link" onClick={onTaken}>
              See open times
            </button>
          )}
        </StatusLine>
      )}
      <PrivacyNote />
    </form>
  );
}
