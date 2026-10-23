import { useQueryClient } from "@tanstack/react-query";
import {
  getListQrCodesQueryKey,
  useCreateQrCode,
  useListQrCodes,
  useUpdateQrCode,
} from "@workspace/api-client-react";
import { Plus, QrCode } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge, Button, EmptyState, ErrorPanel, Field, PageHeading, SkeletonRows } from "@/components/ui-kit";

export function QrPage() {
  const q = useListQrCodes({ query: { queryKey: getListQrCodesQueryKey(), retry: 1 } });
  const create = useCreateQrCode();
  const update = useUpdateQrCode();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("care");
  const [campaign, setCampaign] = useState("");
  const invalidate = () => void qc.invalidateQueries({ queryKey: getListQrCodesQueryKey() });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          name,
          destination: destination as "care" | "prayer" | "counselling" | "appointments" | "general",
          campaign: campaign || null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setName("");
        },
      },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="A simple way in"
        title="QR links"
        subtitle="Manage the links people can scan to reach your care portal."
        action={
          <Button onClick={() => setOpen(!open)}>
            <Plus size={16} /> Create QR link
          </Button>
        }
      />
      {open && (
        <form className="inline-form grid-form" onSubmit={submit}>
          <Field label="Link name">
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Destination">
            <select value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="care">Care portal</option>
              <option value="prayer">Prayer</option>
              <option value="counselling">Counselling</option>
              <option value="appointments">Appointments</option>
              <option value="general">General request</option>
            </select>
          </Field>
          <Field label="Campaign (optional)">
            <input value={campaign} onChange={(e) => setCampaign(e.target.value)} />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Create link
          </Button>
        </form>
      )}
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel text="QR links are unavailable." retry={() => void q.refetch()} />
      ) : q.data?.length ? (
        <>
          <div className="receipt-warning">
            <QrCode size={16} /> Links are managed here. A downloadable scannable QR image is not included in
            the current service response.
          </div>
          <div className="qr-list">
            {q.data.map((item) => (
              <article className="qr-card" key={item.id}>
                <div className="qr-preview">
                  <QrCode size={42} />
                  <span>PASTORA</span>
                </div>
                <div className="qr-info">
                  <div>
                    <h3>{item.name}</h3>
                    <Badge label={item.active ? "active" : "inactive"} />
                  </div>
                  <p>
                    {item.destination}
                    {item.campaign ? ` · ${item.campaign}` : ""}
                  </p>
                  <small>
                    Visits {item.visits} <span>·</span> Submissions {item.submissions}
                  </small>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    update.mutate(
                      { qrCodeId: item.id, data: { active: !item.active } },
                      { onSuccess: invalidate },
                    )
                  }
                >
                  {item.active ? "Pause link" : "Activate link"}
                </Button>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          title="No links to share yet"
          description="Create a QR link to direct people to the public pastoral care portal."
        />
      )}
    </>
  );
}
