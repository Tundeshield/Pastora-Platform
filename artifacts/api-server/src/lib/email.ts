/**
 * Email for Pastora. Emails say THAT something happened and link into Pastora; they
 * never carry pastoral content (no prayer text, no counselling details, no notes).
 *
 * Sending is off until RESEND_API_KEY and EMAIL_FROM are set, so nothing is sent from
 * development or tests unless a test installs its own sender.
 */
import { getFirebaseServices } from "./firebase-admin";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

type Sender = (email: Email) => Promise<void>;

let testSender: Sender | null = null;

/** Tests capture emails instead of sending them. Pass null to restore. */
export function setEmailSenderForTesting(sender: Sender | null): void {
  testSender = sender;
}

export function emailConfigured(): boolean {
  return Boolean(testSender || (process.env.RESEND_API_KEY && process.env.EMAIL_FROM));
}

export function appUrl(path = ""): string {
  const base = (process.env.PUBLIC_APP_URL || "https://pastora-platform.netlify.app").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function resendSend(email: Email): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Email provider answered ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Sends every email, never throwing: an email that fails must not fail the action. */
export async function sendEmails(emails: Email[]): Promise<void> {
  if (!emails.length || !emailConfigured()) return;
  const send = testSender ?? resendSend;
  await Promise.allSettled(emails.map((e) => send(e)));
}

const isEmail = (value: unknown): value is string =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;

export function emailFrom(contact: unknown): string | null {
  return isEmail(contact) ? contact.trim() : null;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** One simple, branded layout for every Pastora email. */
export function layout(opts: {
  church: string;
  heading: string;
  lines: string[];
  button?: { label: string; url: string };
  footer: string;
}): { html: string; text: string } {
  const p = (s: string) =>
    `<p style="margin:0 0 14px;font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#3d4a42">${escape(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f1e7;padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border:1px solid #e7decd;border-radius:12px">
<tr><td style="padding:28px 28px 8px">
<p style="margin:0 0 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8a6430">${escape(opts.church)}</p>
<h1 style="margin:0 0 18px;font:500 26px/1.25 Georgia,'Times New Roman',serif;color:#22382d">${escape(opts.heading)}</h1>
${opts.lines.map(p).join("\n")}
${
  opts.button
    ? `<p style="margin:22px 0 8px"><a href="${escape(opts.button.url)}" style="display:inline-block;background:#2f4a3c;color:#ffffff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:13px 20px;border-radius:8px">${escape(opts.button.label)}</a></p>`
    : ""
}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #efe7d8">
<p style="margin:0;font:12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8a918b">${escape(opts.footer)}</p>
</td></tr></table>
<p style="margin:14px 0 0;font:12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#a3a89f">Sent by Pastora</p>
</td></tr></table></body></html>`;
  const text = [
    opts.church.toUpperCase(),
    "",
    opts.heading,
    "",
    ...opts.lines,
    ...(opts.button ? ["", `${opts.button.label}: ${opts.button.url}`] : []),
    "",
    "--",
    opts.footer,
  ].join("\n");
  return { html, text };
}

/* ------------------------------------------------------------ team emails */

export type EmailCategory = "care" | "appointments" | "work" | "team";
export const EMAIL_CATEGORIES: EmailCategory[] = ["care", "appointments", "work", "team"];

/** Which preference switch covers each notification type. */
export function categoryOf(type: string): EmailCategory {
  if (type === "appointment") return "appointments";
  if (type === "pastoral_request" || type === "follow_up") return "care";
  if (type === "team" || type === "module") return "team";
  return "work";
}

export type EmailPreferences = Record<EmailCategory, boolean>;

export function preferencesFrom(stored: unknown): EmailPreferences {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  return {
    care: s.care !== false,
    appointments: s.appointments !== false,
    work: s.work !== false,
    team: s.team !== false,
  };
}

/**
 * Emails team members about a notification. Looks up each person's sign-in email,
 * skips disabled accounts and anyone who switched that kind of email off.
 */
export async function emailTeam(
  churchId: string,
  uids: string[],
  type: string,
  title: string,
  targetPath: string,
): Promise<void> {
  if (!uids.length || !emailConfigured()) return;
  const { auth, db } = getFirebaseServices();
  const category = categoryOf(type);
  const [church, prefs, accounts] = await Promise.all([
    db.collection("churches").doc(churchId).get(),
    Promise.all(uids.map((uid) => db.collection("emailPreferences").doc(uid).get())),
    auth.getUsers(uids.map((uid) => ({ uid }))),
  ]);
  const churchName = String(church.get("name") ?? "Your church");
  const wanted = new Set(uids.filter((_, i) => preferencesFrom(prefs[i].data())[category]));
  const emails: Email[] = [];
  for (const account of accounts.users) {
    if (!wanted.has(account.uid) || account.disabled || !account.email) continue;
    const { html, text } = layout({
      church: churchName,
      heading: title,
      lines: [
        category === "care"
          ? "For privacy, the details stay in Pastora. Sign in to read and respond."
          : "Open Pastora to see the details and respond.",
      ],
      button: { label: "Open in Pastora", url: appUrl(targetPath) },
      footer: `You’re getting this because you’re on ${churchName}’s team in Pastora. Choose which emails you get under Your account → Email.`,
    });
    emails.push({ to: account.email, subject: `${title} · ${churchName}`, html, text });
  }
  await sendEmails(emails);
}

/* --------------------------------------------------------- visitor emails */

const FORMAT_LABEL: Record<string, string> = { "in-person": "In person", phone: "Phone call", video: "Video call" };

function whenText(startAt: Date, minutes: number, timeZone: string): string {
  const tz = (() => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone });
      return timeZone;
    } catch {
      return "UTC";
    }
  })();
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(startAt);
  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${day}, ${time(startAt)} – ${time(new Date(startAt.getTime() + minutes * 60000))}`;
}

async function churchInfo(churchId: string) {
  const { db } = getFirebaseServices();
  const church = await db.collection("churches").doc(churchId).get();
  return {
    name: String(church.get("name") ?? "The church"),
    slug: String(church.get("slug") ?? ""),
    timeZone: String(church.get("timeZone") ?? "UTC"),
  };
}

const RECEIPT_HEADINGS: Record<string, string> = {
  prayer: "We’ve received your prayer request.",
  counselling: "We’ve received your request to talk.",
  general: "We’ve received your message.",
};

/** A short receipt to someone who wrote in and gave an email. Repeats nothing they wrote. */
export async function emailVisitorReceipt(churchId: string, contact: unknown, type: string, reference: string): Promise<void> {
  const to = emailFrom(contact);
  if (!to || !emailConfigured() || !RECEIPT_HEADINGS[type]) return;
  const church = await churchInfo(churchId);
  const { html, text } = layout({
    church: church.name,
    heading: RECEIPT_HEADINGS[type],
    lines: [
      type === "counselling"
        ? "Only the pastoral team can see your request. Someone will be in touch to arrange a conversation."
        : type === "prayer"
          ? "Thank you for trusting us with it. We are praying with you."
          : "Someone from the church will get back to you.",
      `Your reference is ${reference}.`,
    ],
    footer: `You’re getting this because you contacted ${church.name} through its care page. If this wasn’t you, you can ignore this email.`,
  });
  await sendEmails([{ to, subject: `${RECEIPT_HEADINGS[type]} · ${church.name}`, html, text }]);
}

/** Tells someone who booked what happened to their time. */
export async function emailBooking(opts: {
  churchId: string;
  contact: unknown;
  status: "confirmed" | "requested" | "declined" | "cancelled";
  startAt: Date;
  minutes: number;
  format: string;
  location?: string | null;
  reference?: string;
}): Promise<void> {
  const to = emailFrom(opts.contact);
  if (!to || !emailConfigured()) return;
  const church = await churchInfo(opts.churchId);
  const when = whenText(opts.startAt, opts.minutes, church.timeZone);
  const how = `${FORMAT_LABEL[opts.format] ?? opts.format}${opts.format === "in-person" && opts.location ? ` · ${opts.location}` : ""}`;
  const heading = {
    confirmed: "Your conversation is booked.",
    requested: "Your requested time is held.",
    declined: "Your requested time isn’t available.",
    cancelled: "Your conversation has been cancelled.",
  }[opts.status];
  const lines = {
    confirmed: [when, how, "We look forward to speaking with you."],
    requested: [when, how, "The church will confirm this time shortly."],
    declined: [`Sorry, the church can’t meet at ${when}.`, "Please choose another time on the care page."],
    cancelled: [`The conversation on ${when} has been cancelled.`, "You can book another time on the care page."],
  }[opts.status];
  if (opts.reference) lines.push(`Reference: ${opts.reference}`);
  const careUrl = church.slug ? appUrl(`/care/${church.slug}?type=appointment`) : undefined;
  const { html, text } = layout({
    church: church.name,
    heading,
    lines,
    button: careUrl && (opts.status === "declined" || opts.status === "cancelled") ? { label: "Choose another time", url: careUrl } : undefined,
    footer: `You’re getting this because you booked time with ${church.name} through Pastora.`,
  });
  await sendEmails([{ to, subject: `${heading} · ${church.name}`, html, text }]);
}

/** Invites someone to a church's team, telling them exactly how to join. */
export async function emailInvitation(opts: {
  churchId: string;
  to: string;
  roleName: string;
  inviterName: string;
  hasAccount: boolean;
}): Promise<void> {
  const to = emailFrom(opts.to);
  if (!to || !emailConfigured()) return;
  const church = await churchInfo(opts.churchId);
  const heading = `You’re invited to join ${church.name} on Pastora.`;
  const { html, text } = layout({
    church: church.name,
    heading,
    lines: [
      `${opts.inviterName} added you to the church team as ${opts.roleName}.`,
      opts.hasAccount
        ? `Sign in with ${to} and you’ll land in ${church.name}.`
        : `Create your Pastora account with this email address (${to}), confirm it, and you’ll land in ${church.name} automatically.`,
    ],
    button: { label: opts.hasAccount ? "Sign in" : "Create my account", url: appUrl(opts.hasAccount ? "/sign-in" : "/sign-up") },
    footer: "If you weren’t expecting this, you can ignore this email; nothing happens unless you sign up.",
  });
  await sendEmails([{ to, subject: heading, html, text }]);
}
