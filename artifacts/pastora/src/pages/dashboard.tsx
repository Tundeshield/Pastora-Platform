import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardQueryKey,
  getListAppointmentsQueryKey,
  getListExpensesQueryKey,
  getListReportsQueryKey,
  getListRequestsQueryKey,
  getListTasksQueryKey,
  useListAppointments,
  useListExpenses,
  useListReports,
  useListRequests,
  useListTasks,
  useUpdateAppointment,
  useUpdateTask,
  type Appointment,
} from "@workspace/api-client-react";
import { ArrowRight, CalendarDays, Check, Clock3, FileText, Receipt, Sun } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import { useAccess } from "@/access";
import { useSession } from "@/auth";
import { ErrorPanel, MutationError, PageHeading, SkeletonRows, formatLabel } from "@/components/ui-kit";
import { KINDS, kindOf, senderOf, shortWhen, snippetOf } from "@/pages/requests";

function greeting(name: string | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name?.trim().split(/\s+/).slice(0, 2).join(" ");
  return first ? `${part}, ${first}.` : `${part}.`;
}

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

/**
 * Today: one list of the things that need this person now, each one a click (or less)
 * from done, and the appointments coming up. No counts to decode.
 */
export function DashboardPage() {
  const session = useSession();
  const access = useAccess();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const modules = session.data?.modules ?? [];
  const uid = session.data?.user.uid;
  const tz = session.data?.church?.timeZone ?? undefined;

  const seesRequests = access.can("enquiries") || access.can("prayer");
  const calendar = access.can("calendar");
  const hasToday = seesRequests || calendar;
  const tasksOn = modules.includes("tasks");
  const reviewsReports = access.isPastor && modules.includes("reports");
  const approvesExpenses = access.isPastor && modules.includes("expenses");

  // People without care access start on the page their access gives them.
  const home =
    (access.can("expenses") || access.can("payments")) && modules.includes("expenses")
      ? "/app/expenses"
      : access.can("reports") && modules.includes("reports")
        ? "/app/reports"
        : tasksOn
          ? "/app/tasks"
          : access.can("team")
            ? "/app/team"
            : "/app/settings";
  useEffect(() => {
    if (session.data && !hasToday) setLocation(home, { replace: true });
  }, [session.data, hasToday, home, setLocation]);

  const requests = useListRequests(undefined, {
    query: { queryKey: getListRequestsQueryKey(), retry: 1, enabled: seesRequests },
  });
  const appointments = useListAppointments({
    query: { queryKey: getListAppointmentsQueryKey(), retry: 1, enabled: calendar },
  });
  const tasks = useListTasks({ query: { queryKey: getListTasksQueryKey(), retry: 1, enabled: hasToday && tasksOn } });
  const reports = useListReports({ query: { queryKey: getListReportsQueryKey(), retry: 1, enabled: reviewsReports } });
  const expenses = useListExpenses({
    query: { queryKey: getListExpensesQueryKey(), retry: 1, enabled: approvesExpenses },
  });
  const updateBooking = useUpdateAppointment();
  const updateTask = useUpdateTask();

  const refresh = () => {
    for (const key of [getListAppointmentsQueryKey(), getListTasksQueryKey(), getGetDashboardQueryKey()])
      void qc.invalidateQueries({ queryKey: key });
  };

  if (!hasToday) return null;
  const loading =
    (seesRequests && requests.isLoading) ||
    (calendar && appointments.isLoading) ||
    (tasksOn && tasks.isLoading);
  const failed = requests.isError || appointments.isError;

  const now = Date.now();
  const today = endOfToday();
  const allRequests = requests.data ?? [];
  const newRequests = allRequests.filter((r) => r.status === "new");
  const followUps = allRequests
    .filter((r) => r.dueAt && new Date(r.dueAt).getTime() <= today && r.status !== "resolved" && r.status !== "closed")
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const bookingRequests = (appointments.data ?? [])
    .filter((a) => a.status === "requested" && new Date(a.startAt).getTime() > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const upcoming = (appointments.data ?? [])
    .filter((a) => a.status === "confirmed" && new Date(a.startAt).getTime() + a.durationMinutes * 60000 > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 6);
  const myTasks = (tasks.data ?? [])
    .filter(
      (t) =>
        t.status !== "completed" &&
        (t.assignedTo === uid || t.assignedTo === null) &&
        t.dueAt &&
        new Date(t.dueAt).getTime() <= today,
    )
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const reportsToReview = (reports.data ?? []).filter((r) => r.status === "submitted");
  const expensesToApprove = (expenses.data ?? []).filter((e) => e.status === "submitted");

  const total =
    newRequests.length +
    followUps.length +
    bookingRequests.length +
    myTasks.length +
    reportsToReview.length +
    expensesToApprove.length;

  const when = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString(undefined, { ...o, ...(tz ? { timeZone: tz } : {}) });

  return (
    <div className="enter today">
      <PageHeading
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        title={greeting(session.data?.user.name)}
        subtitle={
          loading
            ? "Getting your day ready…"
            : total
              ? `${total} ${total === 1 ? "thing needs" : "things need"} you today.`
              : "Nothing needs you right now. Everything is taken care of."
        }
      />
      <MutationError errors={[updateBooking.error, updateTask.error]} />
      {failed ? (
        <ErrorPanel text="Today's list is unavailable." retry={() => (void requests.refetch(), void appointments.refetch())} />
      ) : loading ? (
        <SkeletonRows />
      ) : (
        <div className={`today-columns ${calendar ? "" : "single"}`}>
          <section className="today-list" aria-label="Needs you">
            {total === 0 && (
              <div className="today-clear">
                <Sun size={22} />
                <b>You're all caught up</b>
                <small>New prayer requests, bookings, follow-ups and tasks will show up here.</small>
              </div>
            )}

            <Group title="New in your inbox" show={newRequests.length > 0} more={newRequests.length > 6 ? "/app/requests" : undefined}>
              {newRequests.slice(0, 6).map((r) => {
                const kind = kindOf(r);
                const Icon = KINDS[kind].icon;
                return (
                  <Link key={r.id} href={`/app/requests?open=${r.id}`} className="today-row">
                    <span className={`inbox-icon kind-${kind}`}>
                      <Icon size={15} />
                    </span>
                    <span className="today-main">
                      <b>
                        {senderOf(r)} <em>{KINDS[kind].label}</em>
                      </b>
                      <small>{r.type === "counselling" ? "Confidential request" : snippetOf(r.message)}</small>
                    </span>
                    <time>{shortWhen(r.createdAt)}</time>
                  </Link>
                );
              })}
            </Group>

            <Group title="Waiting for your answer" show={bookingRequests.length > 0}>
              {bookingRequests.map((a) => (
                <div key={a.id} className="today-row">
                  <span className="inbox-icon kind-booking">
                    <CalendarDays size={15} />
                  </span>
                  <Link href={`/app/requests?open=b-${a.id}`} className="today-main">
                    <b>{a.requesterName} wants to meet</b>
                    <small>
                      {when(a.startAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} ·{" "}
                      {formatLabel(a.format)}
                    </small>
                  </Link>
                  <button
                    className="today-do"
                    disabled={updateBooking.isPending}
                    onClick={() =>
                      updateBooking.mutate({ appointmentId: a.id, data: { status: "confirmed" } }, { onSuccess: refresh })
                    }
                  >
                    <Check size={14} /> Confirm
                  </button>
                </div>
              ))}
            </Group>

            <Group title="Follow-ups due" show={followUps.length > 0}>
              {followUps.map((r) => {
                const late = new Date(r.dueAt!).getTime() < new Date().setHours(0, 0, 0, 0);
                return (
                  <Link key={r.id} href={`/app/requests?open=${r.id}`} className="today-row">
                    <span className="inbox-icon kind-follow">
                      <Clock3 size={15} />
                    </span>
                    <span className="today-main">
                      <b>{r.nextAction || `Follow up with ${senderOf(r)}`}</b>
                      <small>
                        {senderOf(r)} · {KINDS[kindOf(r)].label}
                      </small>
                    </span>
                    <time className={late ? "late" : ""}>{late ? "Overdue" : "Today"}</time>
                  </Link>
                );
              })}
            </Group>

            <Group title="Your tasks" show={myTasks.length > 0}>
              {myTasks.map((t) => {
                const late = new Date(t.dueAt!).getTime() < new Date().setHours(0, 0, 0, 0);
                return (
                  <div key={t.id} className="today-row">
                    <button
                      className="today-check"
                      aria-label={`Mark "${t.title}" done`}
                      disabled={updateTask.isPending}
                      onClick={() => updateTask.mutate({ taskId: t.id, data: { status: "completed" } }, { onSuccess: refresh })}
                    >
                      <Check size={13} />
                    </button>
                    <Link href="/app/tasks" className="today-main">
                      <b>{t.title}</b>
                      {t.description && <small>{snippetOf(t.description)}</small>}
                    </Link>
                    <time className={late ? "late" : ""}>{late ? "Overdue" : "Today"}</time>
                  </div>
                );
              })}
            </Group>

            <Group title="Reports to read" show={reportsToReview.length > 0}>
              {reportsToReview.map((r) => (
                <Link key={r.id} href="/app/reports" className="today-row">
                  <span className="inbox-icon kind-report">
                    <FileText size={15} />
                  </span>
                  <span className="today-main">
                    <b>{r.department}</b>
                    <small>{r.period}</small>
                  </span>
                  <time>{shortWhen(r.createdAt)}</time>
                </Link>
              ))}
            </Group>

            <Group title="Expenses to approve" show={expensesToApprove.length > 0}>
              {expensesToApprove.map((e) => (
                <Link key={e.id} href="/app/expenses" className="today-row">
                  <span className="inbox-icon kind-report">
                    <Receipt size={15} />
                  </span>
                  <span className="today-main">
                    <b>{e.description}</b>
                    <small>
                      {e.currency} {e.amount.toLocaleString()}
                      {e.department ? ` · ${e.department}` : ""}
                    </small>
                  </span>
                  <time>{shortWhen(e.createdAt)}</time>
                </Link>
              ))}
            </Group>
          </section>

          {calendar && (
            <aside className="today-side panel">
              <div className="panel-heading">
                <h2 className="serif">Coming up</h2>
                <Link href="/app/appointments" className="under-link">
                  Calendar <ArrowRight size={13} />
                </Link>
              </div>
              {upcoming.length ? (
                upcoming.map((a) => <UpcomingRow key={a.id} a={a} tz={tz} />)
              ) : (
                <p className="today-side-empty">No appointments booked. People can book you from your care page.</p>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, show, more, children }: { title: string; show: boolean; more?: string; children: ReactNode }) {
  if (!show) return null;
  return (
    <div className="today-group">
      <h2>
        {title}
        {more && (
          <Link href={more} className="under-link">
            See all <ArrowRight size={12} />
          </Link>
        )}
      </h2>
      {children}
    </div>
  );
}

function dayLabel(iso: string, tz?: string): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-CA", tz ? { timeZone: tz } : undefined);
  const day = fmt(new Date(iso));
  if (day === fmt(new Date())) return "Today";
  if (day === fmt(new Date(Date.now() + 86_400_000))) return "Tomorrow";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(tz ? { timeZone: tz } : {}) });
}

function UpcomingRow({ a, tz }: { a: Appointment; tz?: string }) {
  return (
    <Link href="/app/appointments" className="upcoming-row">
      <span className="upcoming-when">
        <b>{dayLabel(a.startAt, tz)}</b>
        <small>
          {new Date(a.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) })}
        </small>
      </span>
      <span className="today-main">
        <b>{a.requesterName}</b>
        <small>{a.topic ? snippetOf(a.topic) : formatLabel(a.format)}</small>
      </span>
    </Link>
  );
}
