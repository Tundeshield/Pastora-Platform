import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardQueryKey,
  getListReportsQueryKey,
  useCreateReport,
  useListReports,
  useReviewReport,
  type DepartmentReport,
} from "@workspace/api-client-react";
import { Check, FileText, MessageSquareReply, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useAccess } from "@/access";
import { Badge, Button, ErrorPanel, Field, MutationError, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

const STATUS_LABEL: Record<DepartmentReport["status"], string> = {
  submitted: "Waiting to be read",
  reviewed: "Read",
  needs_follow_up: "Follow-up asked",
};

/**
 * Department leaders send a short update; the pastor reads it and either marks it read
 * or asks for a follow-up. Pastors see what's waiting first.
 */
export function ReportsPage() {
  const access = useAccess();
  const reviewer = access.isPastor;
  const q = useListReports({ query: { queryKey: getListReportsQueryKey(), retry: 1 } });
  const create = useCreateReport();
  const review = useReviewReport();
  const qc = useQueryClient();
  const [writing, setWriting] = useState(false);
  const [show, setShow] = useState<"waiting" | "read">("waiting");
  const empty = { department: "", period: "", activities: "", challenges: "", supportNeeded: "", nextPlans: "" };
  const [form, setForm] = useState(empty);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          ...form,
          challenges: form.challenges.trim() || null,
          supportNeeded: form.supportNeeded.trim() || null,
        },
      },
      { onSuccess: () => (invalidate(), setWriting(false), setForm(empty)) },
    );
  };
  const all = q.data ?? [];
  const waiting = all.filter((r) => r.status === "submitted");
  const list = reviewer ? (show === "waiting" ? waiting : all.filter((r) => r.status !== "submitted")) : all;

  return (
    <>
      <PageHeading
        eyebrow="From your departments"
        title="Reports"
        subtitle={
          reviewer
            ? waiting.length
              ? `${waiting.length} ${waiting.length === 1 ? "report is" : "reports are"} waiting for you to read.`
              : "You've read every report."
            : "Send your department's update to the pastor."
        }
        action={
          !writing && (
            <Button variant={reviewer ? "outline" : "primary"} onClick={() => setWriting(true)}>
              <Plus size={16} /> Write a report
            </Button>
          )
        }
      />
      {writing && (
        <form className="inline-form report-form" onSubmit={submit}>
          <Field label="Department">
            <input
              required
              placeholder="e.g. Choir"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </Field>
          <Field label="For which period">
            <input
              required
              placeholder="e.g. October 2026"
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            />
          </Field>
          <Field label="What happened">
            <textarea required value={form.activities} onChange={(e) => setForm({ ...form, activities: e.target.value })} />
          </Field>
          <Field label="What's next">
            <textarea required value={form.nextPlans} onChange={(e) => setForm({ ...form, nextPlans: e.target.value })} />
          </Field>
          <Field label="Any challenges (optional)">
            <textarea value={form.challenges} onChange={(e) => setForm({ ...form, challenges: e.target.value })} />
          </Field>
          <Field label="Help you need from the pastor (optional)">
            <textarea value={form.supportNeeded} onChange={(e) => setForm({ ...form, supportNeeded: e.target.value })} />
          </Field>
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Sending…" : "Send to the pastor"}
            </Button>
            <Button variant="quiet" onClick={() => (setWriting(false), setForm(empty))}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <MutationError errors={[create.error, review.error]} />
      {reviewer && (
        <div className="inbox-tabs task-tabs" role="tablist">
          <button role="tab" aria-selected={show === "waiting"} onClick={() => setShow("waiting")}>
            To read {waiting.length ? <small>{waiting.length}</small> : null}
          </button>
          <button role="tab" aria-selected={show === "read"} onClick={() => setShow("read")}>
            Read
          </button>
        </div>
      )}
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel text={apiErrorMessage(q.error, "Reports are unavailable.")} retry={() => void q.refetch()} />
      ) : list.length ? (
        <div className="record-list">
          {list.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              canReview={reviewer && report.status === "submitted"}
              busy={review.isPending}
              onReview={(data) => review.mutate({ reportId: report.id, data }, { onSuccess: invalidate })}
            />
          ))}
        </div>
      ) : (
        <div className="inbox-empty task-empty">
          <FileText size={22} />
          <b>{reviewer && show === "waiting" ? "Nothing to read" : "No reports yet"}</b>
          <small>
            {reviewer
              ? "When a department leader sends an update, it appears here and on Today."
              : "Write your first report and it goes straight to the pastor."}
          </small>
        </div>
      )}
    </>
  );
}

function ReportCard({
  report,
  canReview,
  busy,
  onReview,
}: {
  report: DepartmentReport;
  canReview: boolean;
  busy: boolean;
  onReview: (data: { status: "reviewed" | "needs_follow_up"; reviewComment?: string }) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  return (
    <article className="record-card">
      <div className="record-head">
        <div>
          <span className="type-label">{report.period}</span>
          <h3>{report.department}</h3>
          <small>Sent {new Date(report.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small>
        </div>
        <Badge label={STATUS_LABEL[report.status]} />
      </div>
      <p>{report.activities}</p>
      <p>
        <b>What's next:</b> {report.nextPlans}
      </p>
      {report.challenges && (
        <p>
          <b>Challenges:</b> {report.challenges}
        </p>
      )}
      {report.supportNeeded && (
        <p>
          <b>Help needed:</b> {report.supportNeeded}
        </p>
      )}
      {report.reviewComment && <div className="review-comment">Pastor's note: {report.reviewComment}</div>}
      {canReview &&
        (asking ? (
          <form
            className="follow-form"
            onSubmit={(e) => {
              e.preventDefault();
              onReview({ status: "needs_follow_up", reviewComment: comment.trim() });
            }}
          >
            <input
              required
              autoFocus
              maxLength={1000}
              aria-label="What follow-up is needed"
              placeholder="What would you like them to follow up on?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="form-actions">
              <Button type="submit" disabled={busy || !comment.trim()}>
                Send
              </Button>
              <Button variant="quiet" onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="record-actions">
            <Button disabled={busy} onClick={() => onReview({ status: "reviewed" })}>
              <Check size={15} /> Mark as read
            </Button>
            <Button variant="quiet" onClick={() => setAsking(true)}>
              <MessageSquareReply size={15} /> Ask for a follow-up
            </Button>
          </div>
        ))}
    </article>
  );
}
