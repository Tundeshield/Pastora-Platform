import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardQueryKey,
  getListAppointmentsQueryKey,
  useCreateAppointment,
  useListAppointments,
  useUpdateAppointment,
} from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorPanel,
  Field,
  MutationError,
  PageHeading,
  SkeletonRows,
} from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

export function AppointmentsPage() {
  const q = useListAppointments({ query: { queryKey: getListAppointmentsQueryKey(), retry: 1 } });
  const create = useCreateAppointment();
  const update = useUpdateAppointment();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    requesterName: "",
    contact: "",
    startAt: "",
    durationMinutes: "45",
    format: "in-person",
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          ...form,
          durationMinutes: Number(form.durationMinutes),
          status: "confirmed",
          startAt: new Date(form.startAt).toISOString(),
          format: form.format as "in-person" | "phone" | "video",
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setFormOpen(false);
        },
      },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="Time for people"
        title="Appointments"
        subtitle="Requests and confirmed conversations, held in one view."
        action={
          <Button onClick={() => setFormOpen(!formOpen)}>
            <Plus size={16} /> Add appointment
          </Button>
        }
      />
      {formOpen && (
        <form className="inline-form grid-form" onSubmit={submit}>
          <Field label="Name">
            <input
              required
              value={form.requesterName}
              onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
            />
          </Field>
          <Field label="Contact">
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </Field>
          <Field label="Date and time">
            <input
              required
              type="datetime-local"
              value={form.startAt}
              onChange={(e) => setForm({ ...form, startAt: e.target.value })}
            />
          </Field>
          <Field label="Minutes">
            <input
              type="number"
              min="15"
              max="240"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
            />
          </Field>
          <Field label="Format">
            <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              <option value="in-person">In person</option>
              <option value="phone">Phone</option>
              <option value="video">Video</option>
            </select>
          </Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Save appointment"}
          </Button>
        </form>
      )}
      <MutationError errors={[create.error, update.error]} />
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel
          text={apiErrorMessage(q.error, "Appointments are unavailable.")}
          retry={() => void q.refetch()}
        />
      ) : q.data?.length ? (
        <div className="table-card">
          <div className="table-head">
            <span>Conversation</span>
            <span>Date & time</span>
            <span>Format</span>
            <span>Status</span>
            <span>Update</span>
          </div>
          {q.data.map((a) => (
            <div className="table-row" key={a.id}>
              <b>{a.requesterName}</b>
              <span>
                {new Date(a.startAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </span>
              <span>{a.format}</span>
              <Badge label={a.status} />
              <select
                value={a.status}
                aria-label={`Update ${a.requesterName} appointment`}
                onChange={(e) =>
                  update.mutate(
                    {
                      appointmentId: a.id,
                      data: {
                        status: e.target.value as
                          "requested" | "confirmed" | "declined" | "completed" | "cancelled",
                      },
                    },
                    { onSuccess: invalidate },
                  )
                }
              >
                <option value="requested">Requested</option>
                <option value="confirmed">Confirmed</option>
                <option value="declined">Declined</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No appointments yet"
          description="Appointment requests and scheduled conversations will appear here."
        />
      )}
    </>
  );
}
