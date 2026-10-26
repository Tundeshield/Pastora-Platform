import { useQueryClient } from "@tanstack/react-query";
import type { PastoralRequest } from "@workspace/api-client-react";
import {
  getGetDashboardQueryKey,
  getListRequestsQueryKey,
  useAddRequestNote,
  useCreateRequest,
  useListRequests,
  useUpdateRequest,
} from "@workspace/api-client-react";
import { ArrowRight, LockKeyhole, Plus } from "lucide-react";
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
  formatDateTime,
} from "@/components/ui-kit";
import { useAccess } from "@/access";
import { apiErrorMessage } from "@/firebase-auth";

export function RequestsPage() {
  const q = useListRequests(undefined, {
    query: { queryKey: getListRequestsQueryKey(), retry: 1 },
  });
  const create = useCreateRequest();
  const update = useUpdateRequest();
  const addNote = useAddRequestNote();
  const qc = useQueryClient();
  // Pastors see every request; others see what their access covers: general
  // enquiries ("enquiries") and/or prayer requests shared with the prayer team ("prayer").
  const access = useAccess();
  const isPastor = access.isPastor;
  const enquiries = access.can("enquiries");
  const prayerTeam = !isPastor && access.can("prayer");
  const view = isPastor
    ? {
        eyebrow: "Private care",
        title: "Care inbox",
        subtitle:
          "A restricted space for pastoral requests and the next faithful step.",
      }
    : enquiries && prayerTeam
      ? {
          eyebrow: "Church office",
          title: "Care inbox",
          subtitle:
            "General enquiries, and prayer requests shared with the prayer team.",
        }
      : enquiries
        ? {
            eyebrow: "Church office",
            title: "Enquiries",
            subtitle: "General enquiries from your church's care page.",
          }
        : {
            eyebrow: "Prayer team",
            title: "Prayer requests",
            subtitle:
              "Requests people chose to share with the prayer team. Hold them in confidence.",
          };
  const blankForm = {
    type: isPastor ? "prayer" : "general",
    name: "",
    contact: "",
    category: "",
    message: "",
  };
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blankForm);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListRequestsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          ...form,
          type: form.type as
            "prayer" | "counselling" | "appointment" | "general",
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setShowForm(false);
          setForm(blankForm);
        },
      },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow={view.eyebrow}
        title={view.title}
        subtitle={view.subtitle}
        action={
          isPastor || enquiries ? (
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus size={16} /> {isPastor ? "New request" : "New enquiry"}
            </Button>
          ) : undefined
        }
      />
      {showForm && (
        <form className="inline-form" onSubmit={submit}>
          {isPastor && (
            <Field label="Request type">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="prayer">Prayer</option>
                <option value="counselling">Counselling</option>
                <option value="appointment">Appointment</option>
                <option value="general">General</option>
              </select>
            </Field>
          )}
          <Field label="Name (optional)">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Contact (optional)">
            <input
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          </Field>
          <Field label="Category">
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </Field>
          <Field label="Request details">
            <textarea
              required
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </Field>
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save request"}
            </Button>
            <Button variant="quiet" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <div className="care-private-banner">
        <LockKeyhole size={17} />
        <span>
          {isPastor
            ? "Restricted pastoral care. Counselling and private notes are for pastors only."
            : prayerTeam
              ? "Only prayer requests people agreed to share appear here, without contact details. Counselling stays with your pastors."
              : "Prayer and counselling requests go to your pastors only, so they don't appear here."}
        </span>
      </div>
      <MutationError errors={[create.error, update.error, addNote.error]} />
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel
          text={apiErrorMessage(
            q.error,
            "Requests are unavailable or your role does not permit access.",
          )}
          retry={() => void q.refetch()}
        />
      ) : q.data?.length ? (
        <div className="record-list">
          {q.data.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              onUpdate={
                isPastor || (enquiries && r.type === "general")
                  ? (status) =>
                      update.mutate(
                        { requestId: r.id, data: { status } },
                        { onSuccess: invalidate },
                      )
                  : undefined
              }
              onNote={
                isPastor
                  ? (note) =>
                      addNote.mutate(
                        { requestId: r.id, data: { note } },
                        { onSuccess: invalidate },
                      )
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="A clear inbox"
          description={
            isPastor
              ? "Pastoral requests will be shown here when they are received."
              : enquiries
                ? "General enquiries will be shown here when they are received."
                : "Prayer requests shared with the prayer team will be shown here."
          }
        />
      )}
    </>
  );
}

export function RequestCard({
  request: r,
  onUpdate,
  onNote,
}: {
  request: PastoralRequest;
  /** Omitted when this person can read the request but not change it. */
  onUpdate?: (s: "acknowledged" | "scheduled" | "resolved" | "closed") => void;
  /** Private notes are for pastors; omitted for staff. */
  onNote?: (n: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <article className="record-card private-card">
      <div className="record-head">
        <div>
          <span className="type-label">{r.type}</span>
          <h3>{r.anonymous ? "Anonymous" : r.name || "Name not provided"}</h3>
          <small>{formatDateTime(r.createdAt)}</small>
        </div>
        <Badge label={r.status} />
      </div>
      <p className="request-message">{r.message}</p>
      <div className="record-meta">
        {r.category && <span>{r.category}</span>}
        {r.contact && <span>{r.contact}</span>}
        {r.nextAction && <span>Next: {r.nextAction}</span>}
      </div>
      {(onUpdate || onNote) && (
        <div className="record-actions">
          {onUpdate && (
            <select
              aria-label="Update request status"
              value={r.status}
              onChange={(e) =>
                onUpdate(
                  e.target.value as
                    "acknowledged" | "scheduled" | "resolved" | "closed",
                )
              }
            >
              <option value="new">New</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="scheduled">Scheduled</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          )}
          {onNote && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) {
                  onNote(note);
                  setNote("");
                }
              }}
            >
              <input
                aria-label="Add a private note"
                placeholder="Add restricted note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button aria-label="Save note">
                <ArrowRight size={15} />
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
