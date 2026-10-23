import { useQueryClient } from "@tanstack/react-query";
import {
  getListReportsQueryKey,
  useCreateReport,
  useListReports,
  useReviewReport,
} from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge, Button, EmptyState, ErrorPanel, Field, PageHeading, SkeletonRows } from "@/components/ui-kit";

export function ReportsPage() {
  const q = useListReports({ query: { queryKey: getListReportsQueryKey(), retry: 1 } });
  const create = useCreateReport();
  const review = useReviewReport();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    department: "",
    period: "",
    activities: "",
    challenges: "",
    supportNeeded: "",
    nextPlans: "",
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { data: { ...form, challenges: form.challenges || null, supportNeeded: form.supportNeeded || null } },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
        },
      },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="Shared stewardship"
        title="Department reports"
        subtitle="Submissions and review notes from across your church."
        action={
          <Button onClick={() => setOpen(!open)}>
            <Plus size={16} /> Submit report
          </Button>
        }
      />
      {open && (
        <form className="inline-form grid-form" onSubmit={submit}>
          <Field label="Department">
            <input
              required
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </Field>
          <Field label="Reporting period">
            <input
              required
              placeholder="e.g. June 2025"
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value })}
            />
          </Field>
          <Field label="Activities">
            <textarea
              required
              value={form.activities}
              onChange={(e) => setForm({ ...form, activities: e.target.value })}
            />
          </Field>
          <Field label="Challenges">
            <textarea
              value={form.challenges}
              onChange={(e) => setForm({ ...form, challenges: e.target.value })}
            />
          </Field>
          <Field label="Support needed">
            <textarea
              value={form.supportNeeded}
              onChange={(e) => setForm({ ...form, supportNeeded: e.target.value })}
            />
          </Field>
          <Field label="Next plans">
            <textarea
              required
              value={form.nextPlans}
              onChange={(e) => setForm({ ...form, nextPlans: e.target.value })}
            />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Submit for review
          </Button>
        </form>
      )}
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel text="Department reports are unavailable." retry={() => void q.refetch()} />
      ) : q.data?.length ? (
        <div className="record-list">
          {q.data.map((report) => (
            <article className="record-card" key={report.id}>
              <div className="record-head">
                <div>
                  <span className="type-label">{report.period}</span>
                  <h3>{report.department}</h3>
                  <small>Submitted {new Date(report.createdAt).toLocaleDateString()}</small>
                </div>
                <Badge label={report.status} />
              </div>
              <p>{report.activities}</p>
              {report.challenges && (
                <p>
                  <b>Challenges:</b> {report.challenges}
                </p>
              )}
              {report.supportNeeded && (
                <p>
                  <b>Support needed:</b> {report.supportNeeded}
                </p>
              )}
              <p>
                <b>Next plans:</b> {report.nextPlans}
              </p>
              {report.reviewComment && (
                <div className="review-comment">Review note: {report.reviewComment}</div>
              )}
              {report.status === "submitted" && (
                <div className="record-actions">
                  <Button
                    variant="outline"
                    onClick={() =>
                      review.mutate(
                        { reportId: report.id, data: { status: "reviewed" } },
                        { onSuccess: invalidate },
                      )
                    }
                  >
                    Mark reviewed
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      const comment = window.prompt("What follow-up is needed?");
                      if (comment !== null)
                        review.mutate(
                          {
                            reportId: report.id,
                            data: { status: "needs_follow_up", reviewComment: comment },
                          },
                          { onSuccess: invalidate },
                        );
                    }}
                  >
                    Request follow-up
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No reports submitted"
          description="Department reports will appear here when shared."
        />
      )}
    </>
  );
}
