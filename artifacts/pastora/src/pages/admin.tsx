import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPlatformWorkspaceQueryKey,
  getListPlatformAuditQueryKey,
  getListPlatformUsersQueryKey,
  getListPlatformWorkspacesQueryKey,
  useGetPlatformWorkspace,
  useListPlatformAudit,
  useListPlatformUsers,
  useListPlatformWorkspaces,
  useUpdatePlatformMember,
  useUpdatePlatformUser,
  useUpdatePlatformWorkspace,
  type MemberRole,
  type PlatformUser,
  type PlatformWorkspace,
} from "@workspace/api-client-react";
import { LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import { FullPageMessage, useAuth, useSession } from "@/auth";
import {
  Badge,
  Button,
  EmptyState,
  ErrorPanel,
  Header,
  MutationError,
  PageHeading,
  SkeletonRows,
  formatDateTime,
} from "@/components/ui-kit";
import { roleLabel } from "@/components/workspace-layout";
import { apiErrorMessage, firebaseAuth, sendPasswordResetEmail } from "@/firebase-auth";

type Tab = "churches" | "accounts" | "activity";
const ROLE_OPTIONS: MemberRole[] = ["pastor", "staff", "finance", "admin"];

/**
 * Pastora Admin: for Pastora's own administrators only (granted on the server).
 * Manages churches and accounts; it never shows prayer, counselling, appointments,
 * reports or expenses.
 */
export function AdminPage() {
  const { status } = useAuth();
  const session = useSession();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("churches");

  useEffect(() => {
    if (status === "signed-out") setLocation("/sign-in?next=/admin", { replace: true });
  }, [status, setLocation]);

  if (status !== "signed-in" || session.isLoading) return <FullPageMessage title="Opening Pastora Admin…" />;
  if (!session.data?.platformAdmin) {
    return (
      <FullPageMessage title="This page is for Pastora administrators.">
        <a className="button primary" href="/app">
          Go to your workspace
        </a>
      </FullPageMessage>
    );
  }

  return (
    <div className="platform-page">
      <Header app />
      <main className="inner-page">
        <PageHeading
          eyebrow="Pastora Admin"
          title="Churches and accounts"
          subtitle="Pause a church, switch an account off, or fix a church's roles."
        />
        <div className="care-private-banner">
          <LockKeyhole size={17} />
          <span>
            By design, this console never shows prayer requests, counselling, appointments, reports or
            expenses. Every action here is recorded under Activity.
          </span>
        </div>
        <div className="admin-tabs" role="tablist">
          {(["churches", "accounts", "activity"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "churches" ? "Churches" : t === "accounts" ? "Accounts" : "Activity"}
            </button>
          ))}
        </div>
        {tab === "churches" && <Churches />}
        {tab === "accounts" && <Accounts myUid={session.data.user.uid} />}
        {tab === "activity" && <ActivityLog />}
      </main>
    </div>
  );
}

function matches(text: string, query: string) {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

function Churches() {
  const list = useListPlatformWorkspaces({ query: { queryKey: getListPlatformWorkspacesQueryKey(), retry: 1 } });
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  if (list.isLoading) return <SkeletonRows />;
  if (list.isError) return <ErrorPanel text={apiErrorMessage(list.error)} retry={() => void list.refetch()} />;
  const shown = (list.data ?? []).filter((w) =>
    matches(`${w.name} ${w.country} ${w.createdByEmail ?? ""} ${w.slug}`, query),
  );
  return (
    <>
      <input
        className="admin-search"
        placeholder="Search churches, countries or emails"
        aria-label="Search churches"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown.length ? (
        <div className="table-card">
          {shown.map((w) => (
            <div key={w.id}>
              <ChurchRow workspace={w} open={openId === w.id} toggle={() => setOpenId(openId === w.id ? null : w.id)} />
              {openId === w.id && <ChurchMembers churchId={w.id} />}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No churches found" description="Churches appear here as soon as they are created." />
      )}
    </>
  );
}

function ChurchRow({ workspace: w, open, toggle }: { workspace: PlatformWorkspace; open: boolean; toggle: () => void }) {
  const update = useUpdatePlatformWorkspace();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const setStatus = (status: "active" | "suspended") =>
    update.mutate(
      { churchId: w.id, data: { status, reason: reason.trim() || null } },
      {
        onSuccess: () => {
          setConfirming(false);
          setReason("");
          void qc.invalidateQueries({ queryKey: getListPlatformWorkspacesQueryKey() });
          void qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey() });
        },
      },
    );
  return (
    <div className="admin-row">
      <div>
        <b>{w.name}</b>
        <small>
          {w.country} · {w.memberCount} {w.memberCount === 1 ? "member" : "members"} · created{" "}
          {new Date(w.createdAt).toLocaleDateString()}
          {w.createdByEmail ? ` by ${w.createdByEmail}` : ""}
        </small>
        <MutationError errors={[update.error]} />
      </div>
      <span>
        <Badge label={w.status === "suspended" ? "paused" : "active"} />
      </span>
      <div className="admin-actions">
        <Button variant="quiet" onClick={toggle}>
          {open ? "Hide people" : "People"}
        </Button>
        {w.status === "suspended" ? (
          <Button variant="outline" onClick={() => setStatus("active")} disabled={update.isPending}>
            Reactivate
          </Button>
        ) : confirming ? (
          <>
            <input
              className="admin-search"
              style={{ margin: 0, maxWidth: 220 }}
              placeholder="Reason (optional)"
              aria-label={`Reason for pausing ${w.name}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button onClick={() => setStatus("suspended")} disabled={update.isPending}>
              Confirm pause
            </Button>
            <Button variant="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Pause church
          </Button>
        )}
      </div>
    </div>
  );
}

function ChurchMembers({ churchId }: { churchId: string }) {
  const detail = useGetPlatformWorkspace(churchId, {
    query: { queryKey: getGetPlatformWorkspaceQueryKey(churchId), retry: 1 },
  });
  const update = useUpdatePlatformMember();
  const qc = useQueryClient();
  if (detail.isLoading) return <SkeletonRows />;
  if (detail.isError) return <ErrorPanel text={apiErrorMessage(detail.error)} retry={() => void detail.refetch()} />;
  return (
    <div className="admin-detail" style={{ padding: "0 17px 12px" }}>
      <p className="admin-note">
        Change a role only to rescue a church, for example when its only pastor or admin has left. The church's
        pastors and admins are notified.
      </p>
      <MutationError errors={[update.error]} />
      {detail.data?.members.map((m) => (
        <div className="admin-row" key={m.uid}>
          <div>
            <b>{m.name}</b>
            <small>{m.email}</small>
          </div>
          <span>
            {!m.active ? `Access removed (${roleLabel(m.role)})` : m.disabled ? "Account disabled" : ""}
          </span>
          <div className="admin-actions">
            {m.active && (
              <select
                aria-label={`Role for ${m.email}`}
                value={m.role}
                onChange={(e) =>
                  update.mutate(
                    { churchId, uid: m.uid, data: { role: e.target.value as MemberRole } },
                    {
                      onSuccess: () => {
                        void qc.invalidateQueries({ queryKey: getGetPlatformWorkspaceQueryKey(churchId) });
                        void qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey() });
                      },
                    },
                  )
                }
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Accounts({ myUid }: { myUid: string }) {
  const list = useListPlatformUsers({ query: { queryKey: getListPlatformUsersQueryKey(), retry: 1 } });
  const [query, setQuery] = useState("");
  if (list.isLoading) return <SkeletonRows />;
  if (list.isError) return <ErrorPanel text={apiErrorMessage(list.error)} retry={() => void list.refetch()} />;
  const shown = (list.data ?? []).filter((u) => matches(`${u.email} ${u.name ?? ""} ${u.churchName ?? ""}`, query));
  return (
    <>
      <input
        className="admin-search"
        placeholder="Search by email, name or church"
        aria-label="Search accounts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown.length ? (
        <div className="table-card">
          {shown.map((u) => (
            <AccountRow key={u.uid} account={u} isMe={u.uid === myUid} />
          ))}
        </div>
      ) : (
        <EmptyState title="No accounts found" description="Accounts appear here when people sign up." />
      )}
    </>
  );
}

function AccountRow({ account: u, isMe }: { account: PlatformUser; isMe: boolean }) {
  const update = useUpdatePlatformUser();
  const qc = useQueryClient();
  const [resetNote, setResetNote] = useState("");
  const [resetError, setResetError] = useState<unknown>(null);
  const sendReset = async () => {
    setResetError(null);
    try {
      if (!firebaseAuth) throw new Error("Account services are not configured.");
      await sendPasswordResetEmail(firebaseAuth, u.email);
      setResetNote(`Password reset email sent to ${u.email}.`);
    } catch (error) {
      setResetError(error);
    }
  };
  return (
    <div className="admin-row">
      <div>
        <b>
          {u.email}
          {isMe ? " (you)" : ""}
        </b>
        <small>
          {u.churchName ? `${u.churchName} · ${roleLabel(u.role ?? undefined)}` : "No church yet"}
          {" · "}
          {u.emailVerified ? "email confirmed" : "email not confirmed"}
          {u.lastSignInAt ? ` · last signed in ${formatDateTime(u.lastSignInAt)}` : ""}
          {u.platformAdmin ? " · Pastora admin" : ""}
        </small>
        {resetNote && <small>{resetNote}</small>}
        <MutationError errors={[update.error, resetError]} />
      </div>
      <span>
        <Badge label={u.disabled ? "disabled" : "active"} />
      </span>
      <div className="admin-actions">
        <Button variant="quiet" onClick={() => void sendReset()}>
          Send password reset
        </Button>
        {!isMe && (
          <Button
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { uid: u.uid, data: { disabled: !u.disabled } },
                {
                  onSuccess: () => {
                    void qc.invalidateQueries({ queryKey: getListPlatformUsersQueryKey() });
                    void qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey() });
                  },
                },
              )
            }
          >
            {u.disabled ? "Enable account" : "Disable account"}
          </Button>
        )}
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  workspace_suspended: "Paused church",
  workspace_reactivated: "Reactivated church",
  account_disabled: "Disabled account",
  account_enabled: "Enabled account",
  member_role_changed: "Changed role",
};

function ActivityLog() {
  const log = useListPlatformAudit({ query: { queryKey: getListPlatformAuditQueryKey(), retry: 1 } });
  if (log.isLoading) return <SkeletonRows />;
  if (log.isError) return <ErrorPanel text={apiErrorMessage(log.error)} retry={() => void log.refetch()} />;
  if (!log.data?.length) {
    return <EmptyState title="Nothing yet" description="Actions taken in Pastora Admin will be listed here." />;
  }
  return (
    <div className="table-card">
      {log.data.map((entry) => (
        <div className="admin-row" key={entry.id}>
          <div>
            <b>
              {ACTION_LABELS[entry.action] ?? entry.action}: {entry.target}
            </b>
            <small>
              {entry.actorEmail} · {formatDateTime(entry.createdAt)}
              {entry.details ? ` · ${entry.details}` : ""}
            </small>
          </div>
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
