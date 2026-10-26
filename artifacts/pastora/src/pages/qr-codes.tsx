import { useQueryClient } from "@tanstack/react-query";
import {
  getListQrCodesQueryKey,
  useCreateQrCode,
  useListQrCodes,
  useUpdateQrCode,
  type QrCode,
} from "@workspace/api-client-react";
import {
  CalendarDays,
  Copy,
  Download,
  ExternalLink,
  HandHeart,
  HeartHandshake,
  LockKeyhole,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Sparkles,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { useSession } from "@/auth";
import { Badge, Button, EmptyState, ErrorPanel, Field, MutationError, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";
import { churchUrl } from "@/site";

type Destination = QrCode["destination"];

/** What each link is for, what people see when they scan it, and its default words. */
const PURPOSES: {
  value: Destination;
  icon: ReactNode;
  label: string;
  opens: string;
  headline: string;
  example: string;
}[] = [
  {
    value: "welcome",
    icon: <Sparkles size={18} />,
    label: "Welcome card",
    opens: "A short connect card for first-time guests: name, contact, how they heard, what they'd like.",
    headline: "New here? We'd love to meet you.",
    example: "Seat backs, the welcome desk, Sunday slides",
  },
  {
    value: "prayer",
    icon: <HandHeart size={18} />,
    label: "Prayer requests",
    opens: "A simple prayer request form. People can stay anonymous and choose to share with the prayer team.",
    headline: "How can we pray for you?",
    example: "Prayer room, altar call, bulletin",
  },
  {
    value: "appointments",
    icon: <CalendarDays size={18} />,
    label: "Book with the pastor",
    opens: "Your open times, so people can pick a slot and book a conversation.",
    headline: "Book a time to talk with the pastor.",
    example: "Pastor's office door, announcements",
  },
  {
    value: "counselling",
    icon: <LockKeyhole size={18} />,
    label: "Confidential help",
    opens: "A private request seen only by pastors, for people who need to talk in confidence.",
    headline: "Need to talk to someone in confidence?",
    example: "Restrooms, counselling flyers",
  },
  {
    value: "general",
    icon: <MessageCircle size={18} />,
    label: "Questions",
    opens: "A message form for questions about services, events and getting involved.",
    headline: "Got a question? Ask us.",
    example: "Event posters, the foyer",
  },
  {
    value: "care",
    icon: <HeartHandshake size={18} />,
    label: "Whole care page",
    opens: "Every option at once: prayer, booking, confidential help, questions and the welcome card.",
    headline: "We're here for you.",
    example: "Website, social media bio, general posters",
  },
];
const purposeOf = (d: Destination) => PURPOSES.find((p) => p.value === d) ?? PURPOSES[PURPOSES.length - 1];

/**
 * The public link only ever contains the church's public address, the page type and
 * the QR link id — never names, contacts or request details.
 */
export function publicFormUrl(slug: string, destination: Destination, qrId?: string): string {
  // The church's own address when configured (grace.getpastora.app), else /care/<church>.
  const url = new URL(churchUrl(slug, { page: "care" }));
  const type = {
    care: null,
    prayer: "prayer",
    counselling: "counselling",
    appointments: "appointment",
    general: "general",
    welcome: "welcome",
  }[destination];
  if (type) url.searchParams.set("type", type);
  if (qrId) url.searchParams.set("qr", qrId);
  return url.toString();
}

function fileName(name: string, suffix: string) {
  return `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pastora"
  }-${suffix}.png`;
}

/** Wraps text onto lines that fit a width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** A printable A5-shaped poster: church name, the link's headline, the code, and a nudge. */
async function poster(opts: { church: string; headline: string; message: string | null; url: string }): Promise<string> {
  const W = 1240;
  const H = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const css = getComputedStyle(document.documentElement);
  const primary = `hsl(${css.getPropertyValue("--primary").trim() || "153 30% 25%"})`;
  ctx.fillStyle = "#fbf8f2";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, W, 18);
  ctx.textAlign = "center";
  ctx.fillStyle = primary;
  ctx.font = "600 34px Inter, system-ui, sans-serif";
  ctx.fillText(opts.church.toUpperCase(), W / 2, 150);
  ctx.fillStyle = "#1f2a24";
  ctx.font = "84px Georgia, 'Times New Roman', serif";
  const head = wrap(ctx, opts.headline, W - 220).slice(0, 3);
  head.forEach((l, i) => ctx.fillText(l, W / 2, 290 + i * 100));
  let y = 290 + head.length * 100;
  if (opts.message) {
    ctx.fillStyle = "#5d665f";
    ctx.font = "38px Inter, system-ui, sans-serif";
    const msg = wrap(ctx, opts.message, W - 280).slice(0, 4);
    msg.forEach((l, i) => ctx.fillText(l, W / 2, y + 20 + i * 54));
    y += 20 + msg.length * 54;
  }
  const size = 720;
  const qr = await QRCode.toDataURL(opts.url, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#1f2a24", light: "#ffffff" } });
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = qr;
  });
  const qrY = Math.max(y + 60, 640);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect((W - size) / 2 - 30, qrY - 30, size + 60, size + 60);
  ctx.drawImage(img, (W - size) / 2, qrY, size, size);
  ctx.fillStyle = "#1f2a24";
  ctx.font = "600 40px Inter, system-ui, sans-serif";
  ctx.fillText("Point your phone camera here", W / 2, qrY + size + 110);
  ctx.fillStyle = "#8a918b";
  ctx.font = "28px Inter, system-ui, sans-serif";
  ctx.fillText("Private and simple · powered by Pastora", W / 2, H - 70);
  return canvas.toDataURL("image/png");
}

function QrCard({
  item,
  slug,
  church,
  onToggle,
  onSave,
  saving,
}: {
  item: QrCode;
  slug: string;
  church: string;
  onToggle: () => void;
  onSave: (data: { name: string; headline: string | null; message: string | null }) => void;
  saving: boolean;
}) {
  const url = publicFormUrl(slug, item.destination, item.id);
  const purpose = purposeOf(item.destination);
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ name: item.name, headline: item.headline ?? "", message: item.message ?? "" });
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: "M" }).then((data) => {
      if (!cancelled) setImage(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  const downloadPoster = async () => {
    const data = await poster({
      church,
      headline: item.headline || purpose.headline,
      message: item.message ?? null,
      url,
    });
    const a = document.createElement("a");
    a.href = data;
    a.download = fileName(item.name, "poster");
    a.click();
  };

  return (
    <article className={`qr-card ${item.active ? "" : "paused"}`}>
      <div className="qr-image">{image ? <img src={image} alt={`QR code for ${item.name}`} /> : null}</div>
      <div className="qr-info">
        <div>
          <h3>{item.name}</h3>
          <Badge label={item.active ? "active" : "paused"} />
        </div>
        <p className="qr-purpose">
          {purpose.icon} {purpose.label}
          {item.campaign ? ` · ${item.campaign}` : ""}
        </p>
        <p className="qr-headline">“{item.headline || purpose.headline}”</p>
        <small>
          {item.visits} {item.visits === 1 ? "scan" : "scans"} <span>·</span> {item.submissions} sent
        </small>
        {editing && (
          <form
            className="qr-edit"
            onSubmit={(e) => {
              e.preventDefault();
              onSave({ name: edit.name.trim(), headline: edit.headline.trim() || null, message: edit.message.trim() || null });
              setEditing(false);
            }}
          >
            <Field label="Name (only your team sees this)">
              <input required maxLength={120} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Heading people see">
              <input
                maxLength={120}
                placeholder={purpose.headline}
                value={edit.headline}
                onChange={(e) => setEdit({ ...edit, headline: e.target.value })}
              />
            </Field>
            <Field label="A line under it (optional)">
              <textarea maxLength={600} value={edit.message} onChange={(e) => setEdit({ ...edit, message: e.target.value })} />
            </Field>
            <div className="form-actions">
              <Button type="submit" disabled={saving}>
                Save
              </Button>
              <Button variant="quiet" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
      <div className="qr-actions">
        <Button variant="outline" onClick={() => void downloadPoster()}>
          <Printer size={15} /> Poster
        </Button>
        <Button variant="outline" onClick={() => void copy()}>
          <Copy size={15} /> {copied ? "Copied" : "Copy link"}
        </Button>
        <a className="button quiet" href={image || undefined} download={fileName(item.name, "qr")} aria-disabled={!image}>
          <Download size={15} /> QR only
        </a>
        <a className="button quiet" href={url} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Preview
        </a>
        <Button variant="quiet" onClick={() => setEditing(!editing)}>
          <Pencil size={14} /> Edit
        </Button>
        <Button variant="quiet" onClick={onToggle}>
          {item.active ? "Pause" : "Turn on"}
        </Button>
      </div>
    </article>
  );
}

export function QrPage() {
  const session = useSession();
  const slug = session.data?.church?.slug ?? "";
  const churchName = session.data?.church?.name ?? "";
  const q = useListQrCodes({ query: { queryKey: getListQrCodesQueryKey(), retry: 1 } });
  const create = useCreateQrCode();
  const update = useUpdateQrCode();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [form, setForm] = useState({ name: "", campaign: "", headline: "", message: "" });
  const invalidate = () => void qc.invalidateQueries({ queryKey: getListQrCodesQueryKey() });
  const purpose = destination ? purposeOf(destination) : null;
  const reset = () => {
    setOpen(false);
    setDestination(null);
    setForm({ name: "", campaign: "", headline: "", message: "" });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!destination) return;
    create.mutate(
      {
        data: {
          name: form.name.trim() || purposeOf(destination).label,
          destination,
          campaign: form.campaign.trim() || null,
          headline: form.headline.trim() || null,
          message: form.message.trim() || null,
        },
      },
      { onSuccess: () => (invalidate(), reset()) },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="A simple way in"
        title="QR links"
        subtitle="Each link opens a page made for one purpose — a welcome card, prayer, booking time with you — with your own words on it."
        action={
          <Button onClick={() => (open ? reset() : setOpen(true))}>
            <Plus size={16} /> New QR link
          </Button>
        }
      />
      {open && (
        <div className="qr-create">
          {!destination ? (
            <>
              <p className="eyebrow">What should people do when they scan it?</p>
              <div className="purpose-grid">
                {PURPOSES.map((p) => (
                  <button key={p.value} className="purpose-card" onClick={() => setDestination(p.value)}>
                    <span className="choice-icon">{p.icon}</span>
                    <b>{p.label}</b>
                    <small>{p.opens}</small>
                    <em>Good for: {p.example}</em>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form className="qr-create-form" onSubmit={submit}>
              <div className="qr-create-head">
                <span className="choice-icon">{purpose?.icon}</span>
                <span>
                  <b>{purpose?.label}</b>
                  <small>{purpose?.opens}</small>
                </span>
                <button type="button" className="under-link" onClick={() => setDestination(null)}>
                  Change
                </button>
              </div>
              <div className="inline-form">
                <Field label="Heading people see">
                  <input
                    maxLength={120}
                    placeholder={purpose?.headline}
                    value={form.headline}
                    onChange={(e) => setForm({ ...form, headline: e.target.value })}
                  />
                </Field>
                <Field label="Name for your team">
                  <input
                    maxLength={120}
                    placeholder={`e.g. ${purpose?.label} – Sunday bulletin`}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <Field label="A line under the heading (optional)">
                  <textarea
                    maxLength={600}
                    placeholder="e.g. Thank you for worshipping with us at Harvest Sunday."
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                  />
                </Field>
                <Field label="Event or campaign (optional, for your records)">
                  <input
                    maxLength={120}
                    placeholder="e.g. Harvest Sunday 2026"
                    value={form.campaign}
                    onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                  />
                </Field>
              </div>
              <div className="form-actions">
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create QR link"}
                </Button>
                <Button variant="quiet" onClick={reset}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      <MutationError errors={[create.error, update.error]} />
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel text={apiErrorMessage(q.error, "QR links are unavailable.")} retry={() => void q.refetch()} />
      ) : q.data?.length ? (
        <div className="qr-list">
          {q.data.map((item) => (
            <QrCard
              key={item.id}
              item={item}
              slug={slug}
              church={churchName}
              saving={update.isPending}
              onToggle={() =>
                update.mutate({ qrCodeId: item.id, data: { active: !item.active } }, { onSuccess: invalidate })
              }
              onSave={(data) => update.mutate({ qrCodeId: item.id, data }, { onSuccess: invalidate })}
            />
          ))}
        </div>
      ) : (
        !open && (
          <EmptyState
            title="No QR links yet"
            description="Start with a welcome card for first-time guests, or a prayer link for the bulletin."
          />
        )
      )}
      {slug && (
        <p className="role-help">
          Your whole care page: <a href={publicFormUrl(slug, "care")}>{publicFormUrl(slug, "care")}</a>
        </p>
      )}
    </>
  );
}
