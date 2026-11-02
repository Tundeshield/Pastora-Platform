import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEmailPreferencesQueryKey,
  useGetEmailPreferences,
  useSaveEmailPreferences,
  useSendTestEmail,
  type EmailPreferencesInput,
} from "@workspace/api-client-react";
import { Mail } from "lucide-react";

import { useSession } from "@/auth";
import { Button, ErrorPanel, MutationError, PageHeading, SkeletonRows, Toggle } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

const KINDS: { key: keyof EmailPreferencesInput; label: string; help: string }[] = [
  {
    key: "care",
    label: "People reaching out",
    help: "New prayer requests, counselling requests, questions and guest cards. The email never includes what they wrote.",
  },
  { key: "appointments", label: "Appointments", help: "New bookings and requests for your time." },
  { key: "work", label: "Tasks, reports and expenses", help: "Tasks given to you, reports to review, expenses to approve or pay, and answers to yours." },
  { key: "team", label: "Team changes", help: "Invitations, role and access changes, and modules switched on or off." },
];

export function AccountPage() {
  const session = useSession();
  return (
    <>
      <PageHeading eyebrow="Your account" title={session.data?.user.name || "Your account"} subtitle={session.data?.user.email ?? ""} />
      <EmailAlertsSection />
    </>
  );
}

/** Each person's own email alerts; shown on Your account and at the top of Settings. */
export function EmailAlertsSection() {
  const q = useGetEmailPreferences({ query: { queryKey: getGetEmailPreferencesQueryKey(), retry: 1 } });
  const save = useSaveEmailPreferences();
  const test = useSendTestEmail();
  const qc = useQueryClient();
  const set = (key: keyof EmailPreferencesInput, value: boolean) => {
    if (!q.data) return;
    const next = {
      care: q.data.care,
      appointments: q.data.appointments,
      work: q.data.work,
      team: q.data.team,
      includeDetails: q.data.includeDetails,
      [key]: value,
    };
    qc.setQueryData(getGetEmailPreferencesQueryKey(), { ...q.data, ...next });
    save.mutate({ data: next }, { onSuccess: (r) => qc.setQueryData(getGetEmailPreferencesQueryKey(), r) });
  };
  return (
    <>
      <section className="settings-section">
        <div>
          <p className="eyebrow">Your email alerts</p>
          <h2 className="serif">What we email you</h2>
          <p>
            Pastora emails you when something needs you, with a button straight to it. Counselling and private notes
            always stay inside Pastora. These choices are yours alone.
          </p>
        </div>
        <div className="settings-fields">
          {q.isLoading ? (
            <SkeletonRows />
          ) : q.isError || !q.data ? (
            <ErrorPanel text={apiErrorMessage(q.error, "Email settings are unavailable.")} retry={() => void q.refetch()} />
          ) : (
            <>
              {!q.data.emailConfigured && (
                <div className="setup-banner">
                  <Mail size={16} />
                  <span>Email isn’t switched on for Pastora yet. Your choices are saved and will apply once it is.</span>
                </div>
              )}
              <p className="settings-note">
                Emails go to <b>{q.data.email ?? "your sign-in address"}</b>.
              </p>
              {KINDS.map((k) => (
                <div className="email-pref" key={k.key}>
                  <Toggle label={k.label} value={q.data![k.key]} onChange={(v) => set(k.key, v)} />
                  <small>{k.help}</small>
                </div>
              ))}
              <div className="email-pref email-pref-details">
                <Toggle
                  label="Show the message in my emails"
                  value={q.data.includeDetails}
                  onChange={(v) => set("includeDetails", v)}
                />
                <small>
                  Read who wrote in, what they asked and when, right in your inbox. Turn off if others can see your
                  email. Counselling is never included.
                </small>
              </div>
              <MutationError errors={[save.error]} />
              <div className="email-test">
                <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
                  {test.isPending ? "Sending…" : "Send me a test email"}
                </Button>
                {test.data && <small className={test.data.sent ? "ok" : "bad"}>{test.data.message}</small>}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
