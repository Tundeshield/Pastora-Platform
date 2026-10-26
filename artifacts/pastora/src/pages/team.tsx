import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTeamQueryKey,
  useCreateInvitation,
  useGetTeam,
  useRevokeInvitation,
  useUpdateMember,
  type MemberRole,
  type Permission,
  type TeamMember,
} from "@workspace/api-client-react";
import { ChevronDown, LockKeyhole, Plus, SlidersHorizontal } from "lucide-react";
import { useState, type FormEvent } from "react";

import { AREAS, AREA_LABEL, CARE_PERMISSIONS, PERMISSIONS, ROLE_DEFAULTS, useAccess } from "@/access";
import { Badge, Button, EmptyState, ErrorPanel, Field, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { roleLabel } from "@/components/workspace-layout";
import { apiErrorMessage } from "@/firebase-auth";

const ROLES: { value: MemberRole; label: string; help: string }[] = [
  {
    value: "pastor",
    label: "Pastor",
    help: "Everything, including counselling, private notes, Message Prep, the blog and approving expenses.",
  },
  { value: "staff", label: "Staff", help: "The church office. Starts with enquiries, the calendar, QR links, reports and expenses." },
  { value: "finance", label: "Finance", help: "Starts with submitting expenses and recording payments." },
  { value: "prayer_team", label: "Prayer team", help: "Starts with prayer requests people chose to share with the prayer team." },
  { value: "admin", label: "Workspace admin", help: "Sets Pastora up: team, settings and QR links. Starts with no access to people's requests." },
];

const sameSet = (a: readonly Permission[], b: readonly Permission[]) =>
  a.length === b.length && a.every((p) => b.includes(p));

/** "Enquiries, Calendar, Expenses" or "Own tasks only". */
function accessSummary(role: MemberRole, permissions: Permission[]) {
  if (role === "pastor") return "Full access";
  if (!permissions.length) return "Own tasks only";
  return PERMISSIONS.filter((p) => permissions.includes(p))
    .map((p) => AREA_LABEL[p])
    .join(" · ");
}

/** The access checkboxes. Care areas are locked for people who can't give them. */
function AccessChecklist({
  value,
  onChange,
  careLocked,
  original = [],
}: {
  value: Permission[];
  onChange: (next: Permission[]) => void;
  careLocked: boolean;
  /** Care areas the person already has can be kept or removed even when locked. */
  original?: Permission[];
}) {
  const toggle = (p: Permission) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="access-list">
      {AREAS.map((group) => (
        <fieldset key={group.group}>
          <legend>
            {group.group}
            {careLocked && group.items.some((i) => CARE_PERMISSIONS.includes(i.key)) && (
              <small>
                <LockKeyhole size={11} /> Only a pastor can give these
              </small>
            )}
          </legend>
          {group.items.map((item) => {
            const locked = careLocked && CARE_PERMISSIONS.includes(item.key) && !original.includes(item.key);
            return (
              <label key={item.key} className={`access-item ${locked ? "locked" : ""}`}>
                <input
                  type="checkbox"
                  checked={value.includes(item.key)}
                  disabled={locked}
                  onChange={() => toggle(item.key)}
                />
                <span>
                  <b>{item.label}</b>
                  <small>{item.help}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
      <p className="access-note">
        Everyone keeps their own tasks. Counselling, private notes, Message Prep, the blog and approving expenses
        always stay with pastors.
      </p>
    </div>
  );
}

export function TeamPage() {
  const access = useAccess();
  const isPastor = access.isPastor;
  const canManage = access.can("team");
  const team = useGetTeam({ query: { queryKey: getGetTeamQueryKey(), retry: 1 } });
  // Once a church has a pastor, only pastors add pastors or give access to requests.
  const hasPastor = (team.data?.members ?? []).some((m) => m.active && m.role === "pastor");
  const careLocked = !isPastor && hasPastor;
  const grantable = ROLES.filter((r) => isPastor || r.value !== "pastor" || !hasPastor);
  const allowedDefaults = (role: MemberRole) =>
    ROLE_DEFAULTS[role].filter((p) => !careLocked || !CARE_PERMISSIONS.includes(p));

  const invite = useCreateInvitation();
  const revoke = useRevokeInvitation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const blank = { email: "", role: "staff" as MemberRole, department: "", permissions: allowedDefaults("staff") };
  const [form, setForm] = useState(blank);
  const [notice, setNotice] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: getGetTeamQueryKey() });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice("");
    const custom = form.role !== "pastor" && !sameSet(form.permissions, allowedDefaults(form.role));
    invite.mutate(
      {
        data: {
          email: form.email.trim(),
          role: form.role,
          department: form.department.trim() || null,
          ...(custom ? { permissions: form.permissions } : {}),
        },
      },
      {
        onSuccess: (created) => {
          refresh();
          setOpen(false);
          setForm(blank);
          setNotice(
            `Invitation saved for ${created.email}. Ask them to create a Pastora account with this email and confirm it — they'll join automatically.`,
          );
        },
      },
    );
  };

  return (
    <>
      <PageHeading
        eyebrow="People and permissions"
        title="Team"
        subtitle="Who can see what in your church workspace."
        action={
          canManage ? (
            <Button
              onClick={() => {
                setForm(blank);
                setOpen(!open);
              }}
            >
              <Plus size={16} /> Invite someone
            </Button>
          ) : undefined
        }
      />
      <p className="role-help">
        A role is a starting point. Use <b>Access</b> to choose exactly what each person can see and do.
        {access.role === "admin" &&
          (hasPastor
            ? " Only a pastor can add a pastor, change a pastor, or give access to people's requests and the calendar; pastors are told about every change."
            : " Invite your pastor first. Once a pastor joins, only pastors can add pastors or give access to people's requests.")}
      </p>
      {open && (
        <form className="inline-form invite-form" onSubmit={submit}>
          <Field label="Email address">
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select
              value={form.role}
              onChange={(e) => {
                const role = e.target.value as MemberRole;
                setForm({ ...form, role, permissions: allowedDefaults(role) });
              }}
            >
              {grantable.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Department (optional)">
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </Field>
          <p className="role-help invite-help">{ROLES.find((r) => r.value === form.role)?.help}</p>
          {form.role !== "pastor" && (
            <div className="invite-access">
              <b>What they can see and do</b>
              <AccessChecklist
                value={form.permissions}
                careLocked={careLocked}
                onChange={(permissions) => setForm({ ...form, permissions })}
              />
            </div>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? "Saving…" : "Save invitation"}
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {invite.error && <div className="inline-error">{apiErrorMessage(invite.error)}</div>}
        </form>
      )}
      {notice && <div className="inline-success">{notice}</div>}
      {revoke.error && <div className="inline-error">{apiErrorMessage(revoke.error)}</div>}
      {team.isLoading ? (
        <SkeletonRows />
      ) : team.isError ? (
        <ErrorPanel text={apiErrorMessage(team.error, "The team is unavailable.")} retry={() => void team.refetch()} />
      ) : (
        <>
          <div className="member-list">
            {team.data?.members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                editable={canManage && !m.isCurrentUser && (m.role !== "pastor" || isPastor)}
                roles={grantable.some((r) => r.value === m.role) ? grantable : [...grantable, ...ROLES.filter((r) => r.value === m.role)]}
                careLocked={careLocked}
                onSaved={refresh}
              />
            ))}
          </div>
          <h2 className="serif section-title">Pending invitations</h2>
          {team.data?.invitations.length ? (
            <div className="member-list">
              {team.data.invitations.map((inv) => (
                <div className="member-row" key={inv.id}>
                  <div className="member-main">
                    <div className="member-id">
                      <b>{inv.email}</b>
                      <small>
                        {roleLabel(inv.role)} · invited {new Date(inv.createdAt).toLocaleDateString()}
                        {inv.department ? ` · ${inv.department}` : ""}
                      </small>
                      <span className="access-summary">{accessSummary(inv.role, inv.permissions)}</span>
                    </div>
                    <div className="member-actions">
                      {canManage && (inv.role !== "pastor" || isPastor || !hasPastor) ? (
                        <Button
                          variant="quiet"
                          onClick={() => revoke.mutate({ invitationId: inv.id }, { onSuccess: refresh })}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <Badge label="pending" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No pending invitations"
              description="Invite a pastor, church office staff, finance, your prayer team or a workspace admin."
            />
          )}
        </>
      )}
    </>
  );
}

function MemberRow({
  member: m,
  editable,
  roles,
  careLocked,
  onSaved,
}: {
  member: TeamMember;
  editable: boolean;
  roles: typeof ROLES;
  careLocked: boolean;
  onSaved: () => void;
}) {
  const update = useUpdateMember();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Permission[]>(m.permissions);
  const save = (data: Parameters<typeof update.mutate>[0]["data"], after?: () => void) =>
    update.mutate(
      { membershipId: m.id, data },
      {
        onSuccess: () => {
          onSaved();
          after?.();
        },
      },
    );

  return (
    <div className={`member-row ${m.active ? "" : "inactive"}`}>
      <div className="member-main">
        <div className="member-id">
          <b>
            {m.name}
            {m.isCurrentUser ? " (you)" : ""}
          </b>
          <small>
            {m.email}
            {m.department ? ` · ${m.department}` : ""}
          </small>
          <span className="access-summary">
            {m.active ? accessSummary(m.role, m.permissions) : "No access"}
            {m.customAccess && m.active ? <em> · adjusted</em> : null}
          </span>
        </div>
        <div className="member-actions">
          {editable && m.active ? (
            <select
              aria-label={`Role for ${m.name}`}
              value={m.role}
              disabled={update.isPending}
              onChange={(e) => save({ role: e.target.value as MemberRole }, () => setEditing(false))}
            >
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="member-role">{roleLabel(m.role)}</span>
          )}
          {editable && m.active && m.role !== "pastor" && (
            <Button
              variant="outline"
              onClick={() => {
                setDraft(m.permissions);
                setEditing(!editing);
              }}
            >
              <SlidersHorizontal size={15} /> Access <ChevronDown size={14} className={editing ? "flip" : ""} />
            </Button>
          )}
          {editable ? (
            <Button variant="quiet" disabled={update.isPending} onClick={() => save({ active: !m.active })}>
              {m.active ? "Remove" : "Restore"}
            </Button>
          ) : (
            !m.active && <Badge label="inactive" />
          )}
        </div>
      </div>
      {editing && (
        <div className="member-access">
          <AccessChecklist value={draft} onChange={setDraft} careLocked={careLocked} original={m.permissions} />
          <div className="form-actions">
            <Button disabled={update.isPending || sameSet(draft, m.permissions)} onClick={() => save({ permissions: draft }, () => setEditing(false))}>
              {update.isPending ? "Saving…" : "Save access"}
            </Button>
            <Button variant="quiet" onClick={() => setDraft(ROLE_DEFAULTS[m.role].filter((p) => !careLocked || !CARE_PERMISSIONS.includes(p) || m.permissions.includes(p)))}>
              Reset to {roleLabel(m.role)} defaults
            </Button>
            <Button variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {update.error && <div className="inline-error">{apiErrorMessage(update.error)}</div>}
    </div>
  );
}
