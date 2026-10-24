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
import { useEffect } from "react";
import { Link, useLocation } from "wouter";

import { useSession } from "@/auth";

import { Badge, EmptyState, ErrorPanel, PageHeading, SkeletonRows, formatLabel } from "@/components/ui-kit";

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
}

/** Pastoral counts, reviews and approvals are for pastors; staff see the office view. */
const PASTOR_ONLY = new Set(["Prayer requests", "Counselling review", "Reports to review", "Expenses awaiting"]);

export function DashboardPage() {
  const session = useSession();
  const role = session.data?.user.role;
  const [, setLocation] = useLocation();
  const hasOverview = role === "pastor" || role === "staff";
  // Finance and the workspace admin have no overview; send them to their main page.
  useEffect(() => {
    if (role === "finance") setLocation("/app/expenses", { replace: true });
    if (role === "admin") setLocation("/app/team", { replace: true });
  }, [role, setLocation]);
  const dashboard = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey(), retry: 1, enabled: hasOverview },
  });
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
        title={greeting()}
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
            {metrics.filter(([label]) => role === "pastor" || !PASTOR_ONLY.has(label)).map(([label, value, href, Icon, hint]) => (
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
          {formatLabel(item.format)}
        </small>
      </div>
      <Badge label={item.status} />
    </div>
  );
}
