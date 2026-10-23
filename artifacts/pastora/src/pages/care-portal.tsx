import {
  getGetPublicChurchQueryKey,
  useGetPublicChurch,
  useSubmitPublicRequest,
} from "@workspace/api-client-react";
import { ArrowRight, CheckCheck, CircleHelp, HeartHandshake, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "wouter";

import { Button, Field, Footer, Header, SkeletonRows, StatusLine, Toggle } from "@/components/ui-kit";

export function CarePortalPage() {
  const { slug = "" } = useParams();
  const church = useGetPublicChurch(slug, {
    query: { queryKey: getGetPublicChurchQueryKey(slug), retry: 1 },
  });
  const submit = useSubmitPublicRequest();
  const [form, setForm] = useState({
    type: "prayer",
    name: "",
    anonymous: false,
    contact: "",
    category: "",
    message: "",
    permissionToContact: false,
    shareWithPrayerTeam: false,
  });
  const [receipt, setReceipt] = useState("");
  const [notReceived, setNotReceived] = useState(false);
  const send = (e: FormEvent) => {
    e.preventDefault();
    setNotReceived(false);
    submit.mutate(
      {
        slug,
        data: {
          ...form,
          type: form.type as "prayer" | "counselling" | "appointment" | "general",
          name: form.anonymous ? null : form.name || null,
          contact: form.contact || null,
          category: form.category || null,
          preferredFormat: null,
          preferredAvailability: null,
          preferredDate: null,
          campaign: null,
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
                    setForm({ ...form, message: "" });
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
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option value="prayer">Prayer</option>
                    <option value="counselling">Counselling</option>
                    {church.data.appointmentEnabled && <option value="appointment">Appointment</option>}
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
                <Field label="Your message">
                  <textarea
                    required
                    minLength={1}
                    maxLength={5000}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                  />
                </Field>
                <Toggle
                  label="It is okay for the church to contact me"
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
                <Button type="submit" disabled={submit.isPending}>
                  {submit.isPending ? "Sending…" : "Send request"} <ArrowRight size={15} />
                </Button>
                {submit.isError && (
                  <StatusLine error>Your message was not submitted. Please try again.</StatusLine>
                )}
                {notReceived && (
                  <StatusLine error>
                    The service did not confirm receipt. Your request has not been shown as submitted.
                  </StatusLine>
                )}
                <small className="privacy-reminder">
                  <LockKeyhole size={13} /> Your request is handled by the church. Only submit what you feel
                  comfortable sharing.
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
