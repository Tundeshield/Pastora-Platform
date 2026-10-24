import {
  getGetPublicChurchQueryKey,
  recordQrVisit,
  useGetPublicChurch,
  useSubmitPublicRequest,
} from "@workspace/api-client-react";
import { ArrowRight, CheckCheck, CircleHelp, HeartHandshake, LockKeyhole } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useParams, useSearch } from "wouter";

import { Button, Field, Footer, Header, SkeletonRows, StatusLine, Toggle } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

type RequestType = "prayer" | "counselling" | "appointment" | "general";
type Format = "in-person" | "phone" | "video";
const TYPES: RequestType[] = ["prayer", "counselling", "appointment", "general"];

/** A datetime-local value for one hour from now, used as the earliest selectable slot. */
function minDateTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function CarePortalPage() {
  const { slug = "" } = useParams();
  const params = new URLSearchParams(useSearch());
  const requestedType = params.get("type");
  const qrCodeId = params.get("qr");
  const church = useGetPublicChurch(slug, {
    query: { queryKey: getGetPublicChurchQueryKey(slug), retry: 1 },
  });
  const submit = useSubmitPublicRequest();
  const initialType: RequestType = TYPES.includes(requestedType as RequestType)
    ? (requestedType as RequestType)
    : "prayer";
  const emptyForm = {
    type: initialType,
    name: "",
    anonymous: false,
    contact: "",
    category: "",
    message: "",
    permissionToContact: false,
    shareWithPrayerTeam: false,
    preferredDate: "",
    preferredFormat: "in-person" as Format,
    preferredAvailability: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [receipt, setReceipt] = useState("");
  const [notReceived, setNotReceived] = useState(false);

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

  // A QR code may point at appointments after the church has switched them off.
  useEffect(() => {
    if (church.data && !church.data.appointmentEnabled && form.type === "appointment") {
      setForm((current) => ({ ...current, type: "general" }));
    }
  }, [church.data, form.type]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    setNotReceived(false);
    const isAppointment = form.type === "appointment";
    submit.mutate(
      {
        slug,
        data: {
          type: form.type,
          anonymous: form.anonymous,
          message: form.message.trim(),
          permissionToContact: form.permissionToContact,
          shareWithPrayerTeam: form.type === "prayer" && form.shareWithPrayerTeam,
          name: form.anonymous ? null : form.name.trim() || null,
          contact: form.contact.trim() || null,
          category: form.category || null,
          preferredFormat: isAppointment || form.type === "counselling" ? form.preferredFormat : null,
          preferredAvailability:
            form.type === "counselling" ? form.preferredAvailability.trim() || null : null,
          preferredDate:
            isAppointment && form.preferredDate ? new Date(form.preferredDate).toISOString() : null,
          campaign: null,
          qrCodeId: qrCodeId || null,
        },
      },
      {
        onSuccess: (r) => {
          if (r.received) setReceipt(r.reference);
          else setNotReceived(true);
        },
      },
    );
  };
  return (
    <div className="public-shell care-portal grain">
      <Header />
      <main className="portal-main">
        {church.isLoading ? (
          <SkeletonRows />
        ) : church.isError ? (
          <div className="portal-error">
            <HeartHandshake />
            <h1 className="serif">This care page is unavailable.</h1>
            <p>The church link may be incorrect or its public portal may not be enabled.</p>
          </div>
        ) : church.data ? (
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
            </div>
            {receipt ? (
              <div className="receipt-success">
                <CheckCheck />
                <p className="eyebrow">Received</p>
                <h2 className="serif">Thank you for reaching out.</h2>
                <p>
                  Your reference is <b>{receipt}</b>. Your message has been sent to the church.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReceipt("");
                    setForm(emptyForm);
                    submit.reset();
                  }}
                >
                  Send another message
                </Button>
              </div>
            ) : (
              <form className="portal-form" onSubmit={send}>
                <p className="eyebrow">Reach out</p>
                <h2 className="serif">Tell us what’s on your heart.</h2>
                <Field label="How can we help?">
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as RequestType })}
                  >
                    <option value="prayer">Prayer</option>
                    <option value="counselling">Counselling</option>
                    {church.data.appointmentEnabled && (
                      <option value="appointment">Book a conversation</option>
                    )}
                    <option value="general">Something else</option>
                  </select>
                </Field>
                {church.data.categories.length > 0 && (
                  <Field label="Category">
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                      <option value="">Choose, if helpful</option>
                      {church.data.categories.map((c) => (
                        <option value={c} key={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Toggle
                  label="I would like to remain anonymous"
                  value={form.anonymous}
                  onChange={(v) => setForm({ ...form, anonymous: v })}
                />
                {!form.anonymous && (
                  <Field label="Your name (optional)">
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                )}
                <Field label="A way to reach you (optional)">
                  <input
                    value={form.contact}
                    onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  />
                </Field>
                {form.type === "appointment" && (
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
                {(form.type === "appointment" || form.type === "counselling") && (
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
                {form.type === "counselling" && (
                  <>
                    <Field label="When are you usually available? (optional)">
                      <input
                        maxLength={500}
                        value={form.preferredAvailability}
                        onChange={(e) => setForm({ ...form, preferredAvailability: e.target.value })}
                      />
                    </Field>
                    <p className="portal-hint">
                      Counselling requests are confidential and only seen by the pastoral care team. We need
                      permission to contact you to arrange a conversation.
                    </p>
                  </>
                )}
                <Field
                  label={form.type === "appointment" ? "What would you like to talk about?" : "Your message"}
                >
                  <textarea
                    required
                    minLength={1}
                    maxLength={5000}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                  />
                </Field>
                <Toggle
                  label={
                    form.type === "counselling"
                      ? "It is okay for the church to contact me (required)"
                      : "It is okay for the church to contact me"
                  }
                  value={form.permissionToContact}
                  onChange={(v) => setForm({ ...form, permissionToContact: v })}
                />
                {form.type === "prayer" && (
                  <Toggle
                    label="Share this request with the prayer team"
                    value={form.shareWithPrayerTeam}
                    onChange={(v) => setForm({ ...form, shareWithPrayerTeam: v })}
                  />
                )}
                <Button
                  type="submit"
                  disabled={submit.isPending || (form.type === "counselling" && !form.permissionToContact)}
                >
                  {submit.isPending ? "Sending…" : "Send request"} <ArrowRight size={15} />
                </Button>
                {submit.isError && (
                  <StatusLine error>
                    {apiErrorMessage(submit.error, "Your message was not submitted. Please try again.")}
                  </StatusLine>
                )}
                {notReceived && (
                  <StatusLine error>
                    The service did not confirm receipt. Your request has not been shown as submitted.
                  </StatusLine>
                )}
                <small className="privacy-reminder">
                  <LockKeyhole size={13} />
                  <span>
                    Your request is handled by the church. Only submit what you feel comfortable sharing.{" "}
                    <a href="/privacy">Privacy</a>
                  </span>
                </small>
              </form>
            )}
          </>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
