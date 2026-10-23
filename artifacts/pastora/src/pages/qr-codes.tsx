import { useQueryClient } from "@tanstack/react-query";
import {
  getListQrCodesQueryKey,
  useCreateQrCode,
  useListQrCodes,
  useUpdateQrCode,
  type QrCode,
} from "@workspace/api-client-react";
import { Copy, Download, ExternalLink, Plus } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";

import { useSession } from "@/auth";
import { Badge, Button, EmptyState, ErrorPanel, Field, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

type Destination = QrCode["destination"];

const DESTINATIONS: { value: Destination; label: string }[] = [
  { value: "care", label: "Care portal (all request types)" },
  { value: "prayer", label: "Prayer request" },
  { value: "counselling", label: "Counselling request" },
  { value: "appointments", label: "Appointment request" },
  { value: "general", label: "General enquiry" },
];

/**
 * The public link only ever contains the church's public slug, the form type and the
 * QR link id — never names, contacts or request details.
 */
export function publicFormUrl(slug: string, destination: Destination, qrId?: string): string {
  const url = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/care/${slug}`, window.location.origin);
  const type = {
    care: null,
    prayer: "prayer",
    counselling: "counselling",
    appointments: "appointment",
    general: "general",
  }[destination];
  if (type) url.searchParams.set("type", type);
  if (qrId) url.searchParams.set("qr", qrId);
  return url.toString();
}

function fileName(name: string) {
  return `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pastora"
  }-qr.png`;
}

function QrCard({ item, slug, onToggle }: { item: QrCode; slug: string; onToggle: () => void }) {
  const url = publicFormUrl(slug, item.destination, item.id);
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);
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

  return (
    <article className="qr-card">
      <div className="qr-image">{image ? <img src={image} alt={`QR code for ${item.name}`} /> : null}</div>
      <div className="qr-info">
        <div>
          <h3>{item.name}</h3>
          <Badge label={item.active ? "active" : "paused"} />
        </div>
        <p>
          {DESTINATIONS.find((d) => d.value === item.destination)?.label}
          {item.campaign ? ` · ${item.campaign}` : ""}
        </p>
        <small>
          Visits {item.visits} <span>·</span> Submissions {item.submissions}
        </small>
        <code className="qr-url">{url}</code>
      </div>
      <div className="qr-actions">
        <a
          className="button outline"
          href={image || undefined}
          download={fileName(item.name)}
          aria-disabled={!image}
        >
          <Download size={15} /> PNG
        </a>
        <Button variant="outline" onClick={() => void copy()}>
          <Copy size={15} /> {copied ? "Copied" : "Copy link"}
        </Button>
        <a className="button quiet" href={url} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Open
        </a>
        <Button variant="quiet" onClick={onToggle}>
          {item.active ? "Pause" : "Activate"}
        </Button>
      </div>
    </article>
  );
}

export function QrPage() {
  const session = useSession();
  const slug = session.data?.church?.slug ?? "";
  const q = useListQrCodes({ query: { queryKey: getListQrCodesQueryKey(), retry: 1 } });
  const create = useCreateQrCode();
  const update = useUpdateQrCode();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState<Destination>("care");
  const [campaign, setCampaign] = useState("");
  const invalidate = () => void qc.invalidateQueries({ queryKey: getListQrCodesQueryKey() });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { data: { name: name.trim(), destination, campaign: campaign.trim() || null } },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setName("");
          setCampaign("");
        },
      },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="A simple way in"
        title="QR links"
        subtitle="Print a code for the bulletin, the lobby or an event. Each scan opens the right public form."
        action={
          <Button onClick={() => setOpen(!open)}>
            <Plus size={16} /> Create QR link
          </Button>
        }
      />
      {slug && (
        <p className="role-help">
          Your public care portal: <a href={publicFormUrl(slug, "care")}>{publicFormUrl(slug, "care")}</a>
        </p>
      )}
      {open && (
        <form className="inline-form grid-form" onSubmit={submit}>
          <Field label="Link name">
            <input
              required
              maxLength={120}
              placeholder="e.g. Sunday bulletin"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Opens">
            <select value={destination} onChange={(e) => setDestination(e.target.value as Destination)}>
              {DESTINATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Campaign or event (optional)">
            <input maxLength={120} value={campaign} onChange={(e) => setCampaign(e.target.value)} />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create link"}
          </Button>
        </form>
      )}
      {(create.error || update.error) && (
        <div className="inline-error">{apiErrorMessage(create.error ?? update.error)}</div>
      )}
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel
          text={apiErrorMessage(q.error, "QR links are unavailable.")}
          retry={() => void q.refetch()}
        />
      ) : q.data?.length ? (
        <div className="qr-list">
          {q.data.map((item) => (
            <QrCard
              key={item.id}
              item={item}
              slug={slug}
              onToggle={() =>
                update.mutate(
                  { qrCodeId: item.id, data: { active: !item.active } },
                  { onSuccess: invalidate },
                )
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No links to share yet"
          description="Create a QR link to direct people to your public pastoral care forms."
        />
      )}
    </>
  );
}
