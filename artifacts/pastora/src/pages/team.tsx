import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTeamQueryKey,
  useCreateInvitation,
  useGetTeam,
  useRevokeInvitation,
  useUpdateMember,
  type MemberRole,
} from "@workspace/api-client-react";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useSession } from "@/auth";
import { Badge, Button, EmptyState, ErrorPanel, Field, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { roleLabel } from "@/components/workspace-layout";
import { apiErrorMessage } from "@/firebase-auth";

const ROLES: { value: MemberRole; label: string; help: string }[] = [
  { value: "pastor", label: "Pastor", help: "Full pastoral care, reviews reports and approves expenses." },
  {
    value: "counsellor",
    label: "Counsellor",
    help: "Sees confidential counselling requests and appointments.",
  },
  { value: "staff", label: "Staff", help: "Appointments, tasks, QR links and general enquiries only." },
  {
    value: "department_leader",
    label: "Department leader",
    help: "Submits department reports and expenses.",
  },
  { value: "finance", label: "Finance", help: "Records payments for approved expenses." },
];

export function TeamPage() {
  const session = useSession();
  const isOwner = session.data?.user.role === "owner";
  const team = useGetTeam({ query: { queryKey: getGetTeamQueryKey(), retry: 1 } });
  const invite = useCreateInvitation();
  const revoke = useRevokeInvitation();
  const updateMember = useUpdateMember();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", role: "staff" as MemberRole, department: "" });
  const [notice, setNotice] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: getGetTeamQueryKey() });
  const actionError = invite.error ?? revoke.error ?? updateMember.error;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice("");
    invite.mutate(
      { data: { email: form.email.trim(), role: form.role, department: form.department.trim() || null } },
      {
        onSuccess: (created) => {
          refresh();
          setOpen(false);
          setForm({ email: "", role: "staff", department: "" });
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
          isOwner ? (
            <Button onClick={() => setOpen(!open)}>
              <Plus size={16} /> Invite someone
            </Button>
          ) : undefined
        }
      />
      {!isOwner && <p className="role-help">Only the church owner can invite people or change roles.</p>}
      {open && (
        <form className="inline-form grid-form" onSubmit={submit}>
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
              onChange={(e) => setForm({ ...form, role: e.target.value as MemberRole })}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Department (optional)">
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </Field>
          <p className="role-help">{ROLES.find((r) => r.value === form.role)?.help}</p>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Saving…" : "Save invitation"}
          </Button>
        </form>
      )}
      {notice && <div className="inline-success">{notice}</div>}
      {actionError && <div className="inline-error">{apiErrorMessage(actionError)}</div>}
      {team.isLoading ? (
        <SkeletonRows />
      ) : team.isError ? (
        <ErrorPanel
          text={apiErrorMessage(team.error, "The team is unavailable.")}
          retry={() => void team.refetch()}
        />
      ) : (
        <>
          <div className="table-card">
            <div className="team-row table-head">
              <span>Member</span>
              <span>Role</span>
              <span>Department</span>
              <span>Access</span>
            </div>
            {team.data?.members.map((m) => {
              const editable = isOwner && !m.isCurrentUser && m.role !== "owner";
              return (
                <div className="team-row" key={m.id}>
                  <div>
                    <b>
                      {m.name}
                      {m.isCurrentUser ? " (you)" : ""}
                    </b>
                    <small>{m.email}</small>
                  </div>
                  {editable ? (
                    <select
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      onChange={(e) =>
                        updateMember.mutate(
                          { membershipId: m.id, data: { role: e.target.value as MemberRole } },
                          { onSuccess: refresh },
                        )
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{roleLabel(m.role)}</span>
                  )}
                  <span>{m.department || "—"}</span>
                  {editable ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        updateMember.mutate(
                          { membershipId: m.id, data: { active: !m.active } },
                          { onSuccess: refresh },
                        )
                      }
                    >
                      {m.active ? "Remove access" : "Restore access"}
                    </Button>
                  ) : (
                    <Badge label={m.active ? "active" : "inactive"} />
                  )}
                </div>
              );
            })}
          </div>
          <h2 className="serif section-title">Pending invitations</h2>
          {team.data?.invitations.length ? (
            <div className="table-card">
              {team.data.invitations.map((inv) => (
                <div className="team-row" key={inv.id}>
                  <div>
                    <b>{inv.email}</b>
                    <small>Invited {new Date(inv.createdAt).toLocaleDateString()}</small>
                  </div>
                  <span>{roleLabel(inv.role)}</span>
                  <span>{inv.department || "—"}</span>
                  {isOwner ? (
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
              ))}
            </div>
          ) : (
            <EmptyState
              title="No pending invitations"
              description="Invite a pastor, counsellor, staff member, department leader or finance officer."
            />
          )}
        </>
      )}
    </>
  );
}
