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
  getListPlatformModulesQueryKey,
  useCreatePlatformModule,
  useDeletePlatformModule,
  useListPlatformModules,
  useUpdatePlatformModule,
  useUpdatePlatformSettings,
  useUpdatePlatformWorkspaceAccess,
  type ModulePlan,
  type ModuleStatus,
  type PlanTier,
  type PlatformModule,
  type MemberRole,
  type PlatformUser,
  type PlatformWorkspace,
} from "@workspace/api-client-react";
import { LockKeyhole, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import { FullPageMessage, useAuth, useSession } from "@/auth";
import {
  Badge,
  Button,
  Field,
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

type Tab = "churches" | "accounts" | "modules" | "activity";
const ROLE_OPTIONS: MemberRole[] = ["pastor", "staff", "finance", "prayer_team", "admin"];
const TAB_LABELS: Record<Tab, string> = {
  churches: "Churches",
  accounts: "Accounts",
  modules: "Modules",
  activity: "Activity",
};

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
          subtitle="Pause a church, switch an account off, fix a church's roles, and manage plans and modules."
        />
        <div className="care-private-banner">
          <LockKeyhole size={17} />
          <span>
            By design, this console never shows prayer requests, counselling, appointments, reports or
            expenses. Every action here is recorded under Activity.
          </span>
        </div>
        <div className="admin-tabs" role="tablist">
          {(["churches", "accounts", "modules", "activity"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        {tab === "churches" && <Churches />}
        {tab === "accounts" && <Accounts myUid={session.data.user.uid} />}
        {tab === "modules" && <ModulesAdmin />}
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
      {detail.data && <ChurchAccess churchId={churchId} plan={detail.data.plan} grants={detail.data.grants} />}
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
  module_created: "Added module",
  module_updated: "Edited module",
  module_deleted: "Deleted module",
  early_access_on: "Turned early access on",
  early_access_off: "Turned early access off",
  workspace_access_changed: "Changed plan or free modules",
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

/* ------------------------------------------------------------------ Modules ---- */

const PLAN_LABELS: Record<string, string> = { starter: "Starter", church: "Church", plus: "Church Plus", addon: "Add-on" };
const STATUS_LABELS: Record<ModuleStatus, string> = {
  available: "Available",
  beta: "Beta",
  coming_soon: "Coming soon",
  retired: "Retired",
};

function slugFor(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/** A church's plan and the modules Pastora gives it free. */
function ChurchAccess({ churchId, plan, grants }: { churchId: string; plan: PlanTier; grants: string[] }) {
  const modules = useListPlatformModules({ query: { queryKey: getListPlatformModulesQueryKey(), retry: 1 } });
  const save = useUpdatePlatformWorkspaceAccess();
  const qc = useQueryClient();
  const apply = (data: { plan?: PlanTier; grants?: string[] }) =>
    save.mutate(
      { churchId, data },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetPlatformWorkspaceQueryKey(churchId) });
          void qc.invalidateQueries({ queryKey: getListPlatformModulesQueryKey() });
          void qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey() });
        },
      },
    );
  const core = ["expenses", "message-prep", "blog"];
  const grantable = (modules.data?.modules ?? []).filter(
    (m) => m.status !== "retired" && (modules.data?.modulesVisible || !core.includes(m.id)),
  );
  return (
    <div className="admin-access">
      <div className="admin-access-row">
        <b>Plan</b>
        <select
          aria-label="Plan"
          value={plan}
          disabled={save.isPending}
          onChange={(e) => apply({ plan: e.target.value as PlanTier })}
        >
          {(["starter", "church", "plus"] as PlanTier[]).map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </select>
        {modules.data && !modules.data.modulesVisible ? (
          <small>The Modules page is hidden: every church gets Expenses, Sermons and Blog, plus anything ticked below.</small>
        ) : (
          modules.data?.earlyAccess && <small>Early access is on, so every church has every available module.</small>
        )}
      </div>
      <div className="admin-access-row">
        <b>Extra features for this church (free)</b>
        <div className="admin-grants">
          {grantable.map((m) => {
            const on = grants.includes(m.id);
            return (
              <label key={m.id} className={`choice-chip ${on ? "selected" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={save.isPending}
                  onChange={() => apply({ grants: on ? grants.filter((g) => g !== m.id) : [...grants, m.id] })}
                />
                {m.name}
              </label>
            );
          })}
        </div>
      </div>
      <MutationError errors={[save.error]} />
    </div>
  );
}

const BLANK_MODULE = {
  name: "",
  id: "",
  description: "",
  status: "coming_soon" as ModuleStatus,
  plan: "church" as ModulePlan,
  roles: ["pastor"] as MemberRole[],
  priceNote: "",
};

function ModuleForm({
  initial,
  isNew,
  busy,
  onSave,
  onCancel,
}: {
  initial: typeof BLANK_MODULE;
  isNew: boolean;
  busy: boolean;
  onSave: (value: typeof BLANK_MODULE) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [idTouched, setIdTouched] = useState(!isNew);
  return (
    <form
      className="inline-form module-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <Field label="Name">
        <input
          required
          minLength={2}
          maxLength={80}
          value={form.name}
          onChange={(e) =>
            setForm({ ...form, name: e.target.value, id: idTouched ? form.id : slugFor(e.target.value) })
          }
        />
      </Field>
      {isNew && (
        <Field label="Id (permanent)">
          <input
            required
            pattern="[a-z0-9][a-z0-9-]{1,39}"
            value={form.id}
            onChange={(e) => {
              setIdTouched(true);
              setForm({ ...form, id: e.target.value });
            }}
          />
        </Field>
      )}
      <Field label="Status">
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ModuleStatus })}>
          {(Object.keys(STATUS_LABELS) as ModuleStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Included in">
        <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as ModulePlan })}>
          {(["starter", "church", "plus", "addon"] as ModulePlan[]).map((p) => (
            <option key={p} value={p}>
              {p === "addon" ? "Add-on (sold or given separately)" : `${PLAN_LABELS[p]} plan and above`}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Price note (optional)">
        <input
          maxLength={120}
          placeholder="e.g. Priced by usage"
          value={form.priceNote}
          onChange={(e) => setForm({ ...form, priceNote: e.target.value })}
        />
      </Field>
      <fieldset className="module-roles">
        <legend>Who uses it</legend>
        {ROLE_OPTIONS.map((role) => (
          <label key={role} className={`choice-chip ${form.roles.includes(role) ? "selected" : ""}`}>
            <input
              type="checkbox"
              checked={form.roles.includes(role)}
              onChange={() =>
                setForm({
                  ...form,
                  roles: form.roles.includes(role) ? form.roles.filter((r) => r !== role) : [...form.roles, role],
                })
              }
            />
            {roleLabel(role)}
          </label>
        ))}
      </fieldset>
      <Field label="Description churches see">
        <textarea
          required
          minLength={5}
          maxLength={500}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : isNew ? "Add module" : "Save changes"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ModulesAdmin() {
  const list = useListPlatformModules({ query: { queryKey: getListPlatformModulesQueryKey(), retry: 1 } });
  const create = useCreatePlatformModule();
  const settings = useUpdatePlatformSettings();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getListPlatformModulesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListPlatformAuditQueryKey() });
  };
  if (list.isLoading) return <SkeletonRows />;
  if (list.isError) return <ErrorPanel text={apiErrorMessage(list.error)} retry={() => void list.refetch()} />;
  const data = list.data!;
  return (
    <>
      <div className="admin-card">
        <div className="toggle-row">
          <span>
            <b>Modules page for churches</b>
            <small>
              {data.modulesVisible
                ? "On: pastors see a Modules page and switch features on and off themselves."
                : "Off (recommended for now): pastors get a short, simple menu with the core features. Give a church extra features from its page under Churches."}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={data.modulesVisible}
            aria-label="Modules page for churches"
            className={`switch ${data.modulesVisible ? "on" : ""}`}
            disabled={settings.isPending}
            onClick={() => settings.mutate({ data: { modulesVisible: !data.modulesVisible } }, { onSuccess: refresh })}
          >
            <i />
          </button>
        </div>
      </div>
      <div className="admin-card">
        <div className="toggle-row">
          <span>
            <b>Early access</b>
            <small>
              {data.earlyAccess
                ? "On: every church can use every available module, whatever its plan. Turn off when you start charging."
                : "Off: churches get the modules in their plan, plus any you give them free."}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={data.earlyAccess}
            aria-label="Early access"
            className={`switch ${data.earlyAccess ? "on" : ""}`}
            disabled={settings.isPending}
            onClick={() => settings.mutate({ data: { earlyAccess: !data.earlyAccess } }, { onSuccess: refresh })}
          >
            <i />
          </button>
        </div>
        <MutationError errors={[settings.error]} />
      </div>

      <div className="admin-section-head">
        <h2 className="serif section-title">Catalog</h2>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={15} /> Add module
          </Button>
        )}
      </div>
      {adding && (
        <>
          <ModuleForm
            initial={BLANK_MODULE}
            isNew
            busy={create.isPending}
            onCancel={() => setAdding(false)}
            onSave={(value) =>
              create.mutate(
                {
                  data: {
                    ...value,
                    priceNote: value.priceNote.trim() || null,
                  },
                },
                {
                  onSuccess: () => {
                    setAdding(false);
                    refresh();
                  },
                },
              )
            }
          />
          <MutationError errors={[create.error]} />
        </>
      )}
      <div className="table-card">
        {data.modules.map((m) => (
          <ModuleRow key={m.id} module={m} onChanged={refresh} />
        ))}
      </div>

      <h2 className="serif section-title">Suggestions from churches</h2>
      {data.suggestions.length ? (
        <div className="table-card">
          {data.suggestions.map((sugg) => (
            <div className="admin-row" key={sugg.id}>
              <div>
                <b>{sugg.text}</b>
                <small>
                  {sugg.churchName} · {sugg.email} · {formatDateTime(sugg.createdAt)}
                </small>
              </div>
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No suggestions yet" description="Ideas churches send from their Modules page appear here." />
      )}
    </>
  );
}

function ModuleRow({ module: m, onChanged }: { module: PlatformModule; onChanged: () => void }) {
  const update = useUpdatePlatformModule();
  const remove = useDeletePlatformModule();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="admin-module">
      <div className="admin-row">
        <div>
          <b>
            {m.name} {m.builtin && <small className="module-builtin">built in</small>}
          </b>
          <small>
            {m.plan === "addon" ? "Add-on" : `${PLAN_LABELS[m.plan]} plan`}
            {m.priceNote ? ` · ${m.priceNote}` : ""} · {m.activeChurches} using · {m.interestedChurches} want it ·{" "}
            {m.grantedChurches} free
          </small>
        </div>
        <span>
          <Badge label={STATUS_LABELS[m.status]} />
        </span>
        <div className="admin-actions">
          <Button variant="quiet" onClick={() => setEditing(!editing)}>
            {editing ? "Close" : "Edit"}
          </Button>
          {!m.builtin &&
            (confirmDelete ? (
              <>
                <Button
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ moduleId: m.id }, { onSuccess: onChanged })}
                >
                  Confirm delete
                </Button>
                <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
        </div>
      </div>
      {editing && (
        <div style={{ padding: "0 17px 14px" }}>
          {m.builtin && (
            <p className="admin-note">
              Built in: this module holds churches' records, so it can be retired (hidden and switched off for
              everyone, records kept) but not deleted.
            </p>
          )}
          <ModuleForm
            initial={{
              name: m.name,
              id: m.id,
              description: m.description,
              status: m.status,
              plan: m.plan,
              roles: m.roles,
              priceNote: m.priceNote ?? "",
            }}
            isNew={false}
            busy={update.isPending}
            onCancel={() => setEditing(false)}
            onSave={(value) =>
              update.mutate(
                {
                  moduleId: m.id,
                  data: {
                    name: value.name,
                    description: value.description,
                    status: value.status,
                    plan: value.plan,
                    roles: value.roles,
                    priceNote: value.priceNote.trim() || null,
                  },
                },
                {
                  onSuccess: () => {
                    setEditing(false);
                    onChanged();
                  },
                },
              )
            }
          />
        </div>
      )}
      <div style={{ padding: "0 17px" }}>
        <MutationError errors={[update.error, remove.error]} />
      </div>
    </div>
  );
}
