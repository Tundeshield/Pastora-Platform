import type { Appointment } from "@workspace/api-client-react";
import { getGetDashboardQueryKey, useGetDashboard } from "@workspace/api-client-react";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Clock3,
  FileText,
  HeartHandshake,
  LockKeyhole,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";

import { Badge, EmptyState, ErrorPanel, PageHeading, SkeletonRows } from "@/components/ui-kit";

export function DashboardPage() {
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), retry: 1 } });
  const summary = dashboard.data;
  const metrics = [
    [
      "Prayer requests",
      summary?.newPrayerRequests,
      "/app/requests",
      HeartHandshake,
      "A new request needs a first look.",
    ],
    [
      "Counselling review",
      summary?.counsellingAwaitingReview,
      "/app/requests",
      ShieldCheck,
      "Private care awaiting review.",
    ],
    [
      "Appointments",
      summary?.upcomingAppointments,
      "/app/appointments",
      CalendarDays,
      "Upcoming conversations.",
    ],
    ["Follow-ups due", summary?.followUpsDue, "/app/requests", Clock3, "A next step is due."],
    ["Tasks overdue", summary?.overdueTasks, "/app/tasks", ClipboardList, "Work that may need attention."],
    [
      "Reports to review",
      summary?.reportsAwaitingReview,
      "/app/reports",
      FileText,
      "Department submissions.",
    ],
    [
      "Expenses awaiting",
      summary?.expensesAwaitingApproval,
      "/app/expenses",
      Receipt,
      "Requests for approval.",
    ],
  ] as const;
  return (
    <div className="enter">
      <PageHeading
        eyebrow="Pastora / Today"
        title="Good morning."
        subtitle="A clear view of what needs your attention, and what can wait."
        action={
          <Link href="/app/tasks" className="button primary">
            Open my tasks <ArrowRight size={15} />
          </Link>
        }
      />
      {dashboard.isLoading ? (
        <SkeletonRows />
      ) : dashboard.isError ? (
        <ErrorPanel text="Your workspace overview is unavailable." retry={() => void dashboard.refetch()} />
      ) : summary ? (
        <>
          <div className="metrics-grid">
            {metrics.map(([label, value, href, Icon, hint]) => (
              <Link href={href} className="metric-card" key={label}>
                <div className="metric-top">
                  <span>{label}</span>
                  <Icon size={17} />
                </div>
                <strong>{value ?? "—"}</strong>
                <small>{hint}</small>
              </Link>
            ))}
          </div>
          <div className="dashboard-columns">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Coming up</p>
                  <h2 className="serif">Next appointments</h2>
                </div>
                <Link href="/app/appointments" className="under-link">
                  View calendar <ArrowRight size={14} />
                </Link>
              </div>
              {summary.nextAppointments.length ? (
                summary.nextAppointments.map((a) => <AppointmentRow key={a.id} item={a} />)
              ) : (
                <EmptyState
                  title="Nothing on the calendar yet"
                  description="Confirmed appointments will appear here."
                />
              )}
            </section>
            <section className="panel follow-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Care, in confidence</p>
                  <h2 className="serif">Follow-ups</h2>
                </div>
                <Link href="/app/requests" className="under-link">
                  Open inbox <ArrowRight size={14} />
                </Link>
              </div>
              {summary.urgentFollowUps.length ? (
                <p className="private-note">
                  <LockKeyhole size={16} /> Sensitive request details are only available in the restricted
                  care inbox.
                </p>
              ) : (
                <EmptyState
                  title="No urgent follow-ups"
                  description="Urgent care follow-ups will be surfaced here without sensitive content."
                />
              )}
            </section>
          </div>
        </>
      ) : (
        <EmptyState
          title="Workspace summary unavailable"
          description="No dashboard information has been returned."
        />
      )}
    </div>
  );
}

export function AppointmentRow({ item }: { item: Appointment }) {
  return (
    <div className="data-row">
      <div className="date-tile">
        <b>{new Date(item.startAt).toLocaleDateString(undefined, { day: "2-digit" })}</b>
        <small>{new Date(item.startAt).toLocaleDateString(undefined, { month: "short" })}</small>
      </div>
      <div className="row-main">
        <b>{item.requesterName}</b>
        <small>
          {new Date(item.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} ·{" "}
          {item.format}
        </small>
      </div>
      <Badge label={item.status} />
    </div>
  );
}
