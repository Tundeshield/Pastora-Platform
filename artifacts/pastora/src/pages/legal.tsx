import { ArrowRight, CheckCheck, LifeBuoy, LockKeyhole } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";

import { Button, Field, PublicFrame, StatusLine } from "@/components/ui-kit";

const LAST_UPDATED = "24 October 2026";

type Section = { id: string; title: string; body: ReactNode };

function LegalPage({
  eyebrow,
  title,
  intro,
  sections,
}: {
  eyebrow: string;
  title: ReactNode;
  intro: ReactNode;
  sections: Section[];
}) {
  return (
    <PublicFrame>
      <main className="inner-page legal-page">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="serif">{title}</h1>
        <p className="legal-updated">Last updated {LAST_UPDATED}</p>
        <div className="legal-intro">{intro}</div>
        <nav className="legal-contents" aria-label="On this page">
          <p className="eyebrow">On this page</p>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article>
          {sections.map((s, i) => (
            <section id={s.id} key={s.id}>
              <h2 className="serif">
                {i + 1}. {s.title}
              </h2>
              {s.body}
            </section>
          ))}
        </article>
      </main>
    </PublicFrame>
  );
}

const SupportLink = () => <Link href="/support">Support page</Link>;

export function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title={
        <>
          Privacy,
          <br />
          <em>with care.</em>
        </>
      }
      intro={
        <p>
          People trust churches with some of the most personal things in their lives. Pastora is built so that
          trust stays where it belongs: prayer and counselling requests are seen by pastors, not by the rest of
          the team, and not by us. This policy explains, in plain language, what Pastora collects, why, and the
          choices you have.
        </p>
      }
      sections={[
        {
          id: "who",
          title: "Who we are and our role",
          body: (
            <>
              <p>
                Pastora ("Pastora", "we", "us") provides an online workspace that churches use for pastoral care
                and church administration, and a public care page where people can send requests to their
                church.
              </p>
              <p>
                <b>For information a church puts into Pastora</b>, including requests people send through its
                care page, the church decides what is collected and how it is used. The church is responsible for
                that information, and we process it on the church's behalf and on its instructions. If you sent
                a request to a church, the church is the best first contact for questions about it.
              </p>
              <p>
                <b>For Pastora accounts</b> (the name, email and sign-in details of people who use the
                workspace), and for messages sent to Pastora support, we are responsible.
              </p>
            </>
          ),
        },
        {
          id: "collect",
          title: "What we collect",
          body: (
            <>
              <ul>
                <li>
                  <b>Account details:</b> your name and email address. Passwords are handled by our
                  authentication provider and are never visible to us.
                </li>
                <li>
                  <b>Church details:</b> the church name, country, time zone, care page settings and who belongs
                  to the workspace with which role.
                </li>
                <li>
                  <b>What churches record:</b> requests, private notes, appointments, tasks, department reports
                  and expense requests that members of the church enter.
                </li>
                <li>
                  <b>Care page submissions:</b> the message someone sends and, only if they choose to give them,
                  their name and contact details, along with their choices (for example, staying anonymous or
                  agreeing to be contacted). Anonymous requests store no name.
                </li>
                <li>
                  <b>Support messages:</b> what you send through our Support page.
                </li>
                <li>
                  <b>Technical information:</b> your IP address is used briefly to limit spam on public forms
                  and is not stored with what you send. QR codes count visits and submissions as numbers only,
                  with no information about who scanned them. Your browser stores your sign-in session and the
                  workspace's appearance so the app works; we do not use advertising or analytics trackers.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "sensitive",
          title: "Prayer and counselling requests",
          body: (
            <>
              <p>
                Prayer and counselling requests can reveal religious beliefs, health, family matters and other
                sensitive details. Pastora treats them with extra care:
              </p>
              <ul>
                <li>Only people with the Pastor role in that church can see them.</li>
                <li>
                  Counselling details are stored separately from the rest of the request record, and someone
                  asking for counselling must agree to be contacted.
                </li>
                <li>
                  Pastora's own administration tools do not display the content of care requests, appointments,
                  reports or expenses. Access to the underlying database is limited to the people who operate
                  Pastora, and we only look at a church's content when that church asks us to help, or when the
                  law requires it.
                </li>
                <li>Pastora is not an emergency service. In an emergency, contact local emergency services.</li>
              </ul>
            </>
          ),
        },
        {
          id: "use",
          title: "How we use information",
          body: (
            <ul>
              <li>To provide the workspace and the care page, and to show each person only what their role allows.</li>
              <li>To create and secure accounts, including email confirmation and password resets.</li>
              <li>To send in-app notifications to the right people in a church.</li>
              <li>To prevent abuse, keep the service secure and fix problems.</li>
              <li>To answer support messages.</li>
              <li>To meet legal obligations.</li>
            </ul>
          ),
        },
        {
          id: "sharing",
          title: "Who we share it with",
          body: (
            <>
              <p>We do not sell personal information or use it for advertising. We share it only with:</p>
              <ul>
                <li>
                  <b>Service providers</b> that run Pastora for us: Google Firebase (sign-in and database) and
                  Netlify (website hosting and support form delivery). They process information only to provide
                  their service to us.
                </li>
                <li>
                  <b>Authorities</b>, where the law requires it, or to protect someone's safety.
                </li>
                <li>
                  <b>A successor</b>, if Pastora is ever transferred, under the same protections described here.
                </li>
              </ul>
              <p>
                Our providers may process information in countries other than yours, including the United
                States. Where the law requires it, we rely on appropriate safeguards for those transfers.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          title: "How long we keep it",
          body: (
            <p>
              We keep a church's information while its workspace is active. A church can ask us to delete its
              workspace and everything in it, and an account holder can ask us to delete their account; we will
              do so and confirm when it is done, unless the law requires us to keep something. Support messages
              are kept as long as needed to help you.
            </p>
          ),
        },
        {
          id: "rights",
          title: "Your rights and choices",
          body: (
            <>
              <p>
                Depending on where you live (for example under Nigeria's Data Protection Act, the EU or UK GDPR, or
                US state privacy laws), you may have the right to access, correct, delete or receive a copy of
                your information, to object to or restrict how it is used, and to withdraw consent.
              </p>
              <p>
                For a request you sent to a church, contact that church first; we will help the church respond.
                For your Pastora account, or if you cannot reach the church, use our <SupportLink /> and choose
                "Privacy or data request". You may also complain to your local data protection authority.
              </p>
            </>
          ),
        },
        {
          id: "security",
          title: "Security",
          body: (
            <p>
              Information is encrypted in transit, the database cannot be read directly from the browser, every
              request is checked against the person's church and role, and sensitive actions are recorded. No
              system is perfectly secure, so if we learn of a breach affecting your information we will notify
              the affected church and, where required, the people involved and the authorities.
            </p>
          ),
        },
        {
          id: "children",
          title: "Children",
          body: (
            <p>
              Pastora accounts are for adults acting for their church. Churches that invite young people to use
              their care page are responsible for appropriate consent from a parent or guardian.
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes and contact",
          body: (
            <p>
              We will update this page when our practices change and show the date at the top; for significant
              changes we will also tell churches in Pastora. Questions about privacy are welcome through our{" "}
              <SupportLink />.
            </p>
          ),
        },
      ]}
    />
  );
}

export function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title={
        <>
          Terms of
          <br />
          <em>use.</em>
        </>
      }
      intro={
        <p>
          These terms are the agreement between Pastora and the churches and people who use it. Please read them
          with our <Link href="/privacy">Privacy policy</Link>. By creating an account or using Pastora, you
          agree to them.
        </p>
      }
      sections={[
        {
          id: "service",
          title: "The service",
          body: (
            <p>
              Pastora is an online workspace for pastoral care and church administration, with a public care page
              each church can share. Pastora is in early access: features may change, and we will tell churches
              about changes that affect how they work.
            </p>
          ),
        },
        {
          id: "accounts",
          title: "Accounts",
          body: (
            <ul>
              <li>You must be an adult and give accurate details. Each account is for one person.</li>
              <li>Keep your password private and tell us if you think your account has been misused.</li>
              <li>
                If you create a church workspace, you confirm you are allowed to do so on the church's behalf.
              </li>
            </ul>
          ),
        },
        {
          id: "church",
          title: "The church's responsibilities",
          body: (
            <ul>
              <li>
                Churches decide who joins their workspace and with which role, and are responsible for what their
                members do in it.
              </li>
              <li>
                Churches are responsible for the information they collect, including having a proper basis to
                collect it, being clear with people about how it is used, and answering their requests about it.
              </li>
              <li>
                Churches should give pastoral access only to people they trust with confidential care, and use
                the care page in a way that is safe for the people who use it.
              </li>
            </ul>
          ),
        },
        {
          id: "content",
          title: "Your content",
          body: (
            <p>
              What a church and its members put into Pastora stays theirs. You give us permission to store and
              process it only to run Pastora for you, as described in the Privacy policy. We do not claim
              ownership of it and do not use it for advertising.
            </p>
          ),
        },
        {
          id: "acceptable",
          title: "Acceptable use",
          body: (
            <>
              <p>Please do not:</p>
              <ul>
                <li>break the law, or use Pastora to harass, threaten or harm anyone;</li>
                <li>collect information about people without the right to do so;</li>
                <li>try to access another church's workspace or information you are not permitted to see;</li>
                <li>interfere with the service, probe it for weaknesses without our permission, or overload it;</li>
                <li>send spam or misleading content through the care page or support form.</li>
              </ul>
            </>
          ),
        },
        {
          id: "not-emergency",
          title: "Not an emergency or professional service",
          body: (
            <p>
              Pastora helps churches organise care; it is not an emergency, medical, legal, financial or
              counselling service, and messages are not monitored around the clock. In an emergency, contact
              local emergency services.
            </p>
          ),
        },
        {
          id: "plans",
          title: "Plans and payment",
          body: (
            <p>
              Pastora is currently available without charge during early access. Before any paid plan applies to
              your church we will tell you the price and terms in advance, and nothing will be charged without
              your agreement. You can stop using Pastora at any time.
            </p>
          ),
        },
        {
          id: "suspension",
          title: "Pausing and ending access",
          body: (
            <p>
              You can stop using Pastora and ask us to delete your account or church workspace at any time. We
              may pause or end access if these terms are seriously or repeatedly broken, to protect people or the
              service, or where the law requires it. Where we can, we will tell you first and give you a chance to
              put things right.
            </p>
          ),
        },
        {
          id: "liability",
          title: "Warranties and liability",
          body: (
            <>
              <p>
                We work hard to keep Pastora available, accurate and secure, but it is provided "as is" and we
                cannot promise it will always be uninterrupted or error-free.
              </p>
              <p>
                To the extent the law allows, Pastora is not liable for indirect or consequential losses, and our
                total liability for any claim is limited to the amount the church paid us for Pastora in the
                twelve months before the claim. Nothing in these terms limits liability that cannot be limited by
                law.
              </p>
            </>
          ),
        },
        {
          id: "changes",
          title: "Changes, law and contact",
          body: (
            <p>
              We may update these terms and will show the date at the top; for significant changes we will tell
              churches in Pastora before they take effect. These terms are governed by the laws of the Federal
              Republic of Nigeria, without affecting any rights you have under the laws of the country where you
              live. Questions are welcome through our <SupportLink />.
            </p>
          ),
        },
      ]}
    />
  );
}

const TOPICS = [
  "Getting started",
  "Account or sign-in",
  "Something isn't working",
  "Plans and pricing",
  "Privacy or data request",
  "Something else",
];

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "I didn't get the confirmation email.",
    a: "Check your spam or promotions folder, then use Send the link again on the confirmation screen. Links expire, so use the newest one.",
  },
  {
    q: "I was invited but I don't see my church.",
    a: "Create your Pastora account with exactly the email address you were invited with, then confirm it. You join automatically after confirming.",
  },
  {
    q: "Who can see prayer and counselling requests?",
    a: (
      <>
        Only people with the Pastor role in your church. Staff, finance and the workspace admin cannot, and
        neither can Pastora. See the <Link href="/privacy">Privacy policy</Link>.
      </>
    ),
  },
  {
    q: "I sent a request to my church. Can you help with it?",
    a: "Please contact your church directly. Pastora can't see or answer requests sent to churches.",
  },
];

export function SupportPage() {
  const [form, setForm] = useState({ name: "", email: "", church: "", topic: TOPICS[0], message: "" });
  const [honeypot, setHoneypot] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    try {
      // Netlify Forms: the "support" form is declared in index.html so Netlify detects it at build time.
      const body = new URLSearchParams({ "form-name": "support", "bot-field": honeypot, ...form });
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState("sent");
    } catch {
      setState("error");
    }
  };

  return (
    <PublicFrame>
      <main className="inner-page support-page">
        <div className="support-intro">
          <p className="eyebrow">Support</p>
          <h1 className="serif">
            A human answer,
            <br />
            <em>when you need one.</em>
          </h1>
          <p>
            Questions about setting up your church, a problem with your account, or a privacy request: write to
            us and a person will reply by email, usually within two working days.
          </p>
          <div className="support-faq">
            {FAQS.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
        {state === "sent" ? (
          <div className="receipt-success support-sent" role="status">
            <CheckCheck />
            <h2 className="serif">Thank you. Your message is on its way.</h2>
            <p>We'll reply to {form.email}. If it's urgent and about someone's safety, contact local emergency services.</p>
            <Link className="under-link" href="/">
              Back to Pastora <ArrowRight size={15} />
            </Link>
          </div>
        ) : (
          <form className="portal-form support-form" onSubmit={(e) => void submit(e)}>
            <h2 className="serif">
              <LifeBuoy size={20} /> Write to us
            </h2>
            <p className="hidden-field" aria-hidden="true">
              <label>
                Leave this empty
                <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </label>
            </p>
            <Field label="Your name">
              <input
                required
                maxLength={120}
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Email for our reply">
              <input
                required
                type="email"
                maxLength={254}
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Church (optional)">
              <input
                maxLength={160}
                value={form.church}
                onChange={(e) => setForm({ ...form, church: e.target.value })}
              />
            </Field>
            <Field label="Topic">
              <select value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
                {TOPICS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="How can we help?">
              <textarea
                required
                minLength={10}
                maxLength={4000}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send message"} <ArrowRight size={15} />
            </Button>
            {state === "error" && (
              <StatusLine error>Your message couldn't be sent. Please check your connection and try again.</StatusLine>
            )}
            <small className="privacy-reminder">
              <LockKeyhole size={13} />
              <span>
                Please don't include prayer or counselling details. We use your message only to reply, as
                described in our <Link href="/privacy">Privacy policy</Link>.
              </span>
            </small>
          </form>
        )}
      </main>
    </PublicFrame>
  );
}
