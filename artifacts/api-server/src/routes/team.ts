import { Router, type IRouter } from "express";
import {
  CreateInvitationBody,
  CreateInvitationResponse,
  GetTeamResponse,
  RevokeInvitationParams,
  UpdateMemberBody,
  UpdateMemberParams,
  UpdateMemberResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  audit,
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  iso,
  normalizeRole,
  notifyChurchRoles,
  tenantFor,
  type ChurchRole,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import {
  canInviteRole,
  canManageMember,
  canManageTeam,
  cleanPermissions,
  forbiddenCareGrants,
  normalizeEmail,
  permissionsFor,
  ROLE_DEFAULTS,
  type Permission,
} from "../lib/policies";
import { isAlreadyExists, MEMBERSHIP_LOCKS } from "../lib/workspace-service";

const router: IRouter = Router();

const ROLE_NAMES: Record<ChurchRole, string> = {
  pastor: "Pastor",
  staff: "Staff",
  finance: "Finance",
  admin: "Admin",
  prayer_team: "Prayer team",
};

const AREA_NAMES: Record<Permission, string> = {
  enquiries: "general enquiries",
  prayer: "shared prayer requests",
  calendar: "the pastor's calendar",
  qr: "QR links",
  reports: "department reports",
  expenses: "submitting expenses",
  payments: "recording payments",
  team: "team and settings",
};

const careRefusal = (areas: Permission[]) =>
  `Only a pastor can give access to ${areas.map((a) => AREA_NAMES[a]).join(", ")}.`;

/** True once the church has an active pastor; from then on only pastors add pastors. */
export async function churchHasPastor(churchId: string): Promise<boolean> {
  const { db } = getFirebaseServices();
  const members = await db
    .collection("churchMemberships")
    .where("churchId", "==", churchId)
    .where("active", "==", true)
    .get();
  return members.docs.some((doc) => normalizeRole(doc.get("role")) === "pastor");
}

/** Every pastor hears about team changes, so access is never changed quietly. */
async function tellPastors(churchId: string, eventId: string, title: string): Promise<void> {
  try {
    await notifyChurchRoles(churchId, eventId, "team", title, "/app/team", ["pastor"]);
  } catch {
    // The change itself has been saved; a missed notification must not undo it.
  }
}

async function profilesFor(uids: string[]) {
  const { db } = getFirebaseServices();
  const refs = uids.map((uid) => db.collection("users").doc(uid));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  return new Map(snaps.map((snap) => [snap.id, snap.data() ?? {}]));
}

function memberResponse(
  id: string,
  data: FirebaseFirestore.DocumentData,
  profile: FirebaseFirestore.DocumentData | undefined,
  currentUid: string,
) {
  return {
    id,
    uid: data.uid,
    name: profile?.name ?? profile?.email?.split?.("@")[0] ?? "Member",
    email: profile?.email ?? "",
    role: normalizeRole(data.role) ?? "staff",
    permissions: permissionsFor(normalizeRole(data.role) ?? "staff", data.permissions),
    customAccess: Array.isArray(data.permissions) && normalizeRole(data.role) !== "pastor",
    department: data.department ?? null,
    active: data.active === true,
    isCurrentUser: data.uid === currentUid,
  };
}

router.get("/team", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before managing your team." });
      return;
    }
    if (!canManageTeam(context)) {
      res.status(403).json({ error: "Only pastors and people who manage the team can view it." });
      return;
    }
    const { db } = getFirebaseServices();
    const [members, invitations] = await Promise.all([
      db.collection("churchMemberships").where("churchId", "==", context.churchId).get(),
      db
        .collection("churchInvitations")
        .where("churchId", "==", context.churchId)
        .where("status", "==", "pending")
        .get(),
    ]);
    const profiles = await profilesFor(members.docs.map((doc) => String(doc.get("uid"))));
    res.json(
      GetTeamResponse.parse({
        members: members.docs.map((doc) =>
          memberResponse(doc.id, doc.data(), profiles.get(String(doc.get("uid"))), user.uid),
        ),
        invitations: invitations.docs.map((doc) => ({
          id: doc.id,
          email: doc.get("email"),
          role: normalizeRole(doc.get("role")) ?? "staff",
          permissions: permissionsFor(normalizeRole(doc.get("role")) ?? "staff", doc.get("permissions")),
          department: doc.get("department") ?? null,
          createdAt: iso(doc.get("createdAt")),
        })),
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load the team.") });
  }
});

router.post("/team/invitations", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address and choose a role." });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before inviting people." });
      return;
    }
    if (!canManageTeam(context)) {
      res.status(403).json({ error: "Only pastors and people who manage the team can invite people." });
      return;
    }
    const hasPastor = await churchHasPastor(context.churchId);
    if (!canInviteRole(context, parsed.data.role, hasPastor)) {
      res.status(403).json({ error: "Only a pastor can add another pastor." });
      return;
    }
    // Access: what the inviter chose, or the role's defaults. Care access asked for
    // explicitly by a non-pastor is refused; care defaults are quietly left out.
    const requested = parsed.data.permissions !== undefined ? cleanPermissions(parsed.data.permissions) : null;
    if (requested) {
      const refused = forbiddenCareGrants(context, hasPastor, [], requested);
      if (refused.length) {
        res.status(403).json({ error: careRefusal(refused) });
        return;
      }
    }
    const defaults = [...ROLE_DEFAULTS[parsed.data.role]];
    const defaultsAllowed = defaults.filter((p) => !forbiddenCareGrants(context, hasPastor, [], [p]).length);
    const invitePermissions =
      parsed.data.role === "pastor"
        ? null
        : requested ?? (defaultsAllowed.length === defaults.length ? null : defaultsAllowed);
    const email = normalizeEmail(parsed.data.email);
    if (email === normalizeEmail(user.email ?? "")) {
      res.status(400).json({ error: "You are already a member of this workspace." });
      return;
    }
    const { db, auth } = getFirebaseServices();
    const duplicate = await db
      .collection("churchInvitations")
      .where("churchId", "==", context.churchId)
      .where("email", "==", email)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!duplicate.empty) {
      res.status(409).json({ error: "This person already has a pending invitation." });
      return;
    }
    const existingUser = await auth.getUserByEmail(email).catch(() => null);
    if (existingUser) {
      const membership = await db
        .collection("churchMemberships")
        .where("uid", "==", existingUser.uid)
        .where("active", "==", true)
        .limit(1)
        .get();
      if (!membership.empty) {
        res.status(409).json({ error: "This person already belongs to a church workspace." });
        return;
      }
    }
    const ref = db.collection("churchInvitations").doc();
    await ref.set({
      churchId: context.churchId,
      email,
      role: parsed.data.role,
      // null = the role's defaults, so later changes to defaults apply.
      permissions: invitePermissions,
      department: parsed.data.department?.trim() || null,
      status: "pending",
      invitedBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    await audit(context.churchId, user.uid, "invitation_created", ref.id, { role: parsed.data.role });
    await tellPastors(context.churchId, `invite_${ref.id}`, `${email} was invited as ${ROLE_NAMES[parsed.data.role]}.`);
    const saved = await ref.get();
    res.status(201).json(
      CreateInvitationResponse.parse({
        id: ref.id,
        email,
        role: parsed.data.role,
        permissions: permissionsFor(parsed.data.role, invitePermissions ?? undefined),
        department: saved.get("department") ?? null,
        createdAt: iso(saved.get("createdAt")),
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to create the invitation.") });
  }
});

router.delete("/team/invitations/:invitationId", firebaseAuth, async (req, res): Promise<void> => {
  const params = RevokeInvitationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid invitation." });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding first." });
      return;
    }
    if (!canManageTeam(context)) {
      res.status(403).json({ error: "Only pastors and people who manage the team can revoke invitations." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("churchInvitations").doc(params.data.invitationId);
    const snap = await ref.get();
    if (!snap.exists || snap.get("churchId") !== context.churchId || snap.get("status") !== "pending") {
      res.status(404).json({ error: "Invitation not found." });
      return;
    }
    const inviteRole = normalizeRole(snap.get("role")) ?? "staff";
    if (!canInviteRole(context, inviteRole, await churchHasPastor(context.churchId))) {
      res.status(403).json({ error: "Only a pastor can withdraw a pastor's invitation." });
      return;
    }
    await ref.update({ status: "revoked", revokedBy: user.uid, revokedAt: FieldValue.serverTimestamp() });
    await audit(context.churchId, user.uid, "invitation_revoked", ref.id);
    res.sendStatus(204);
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to revoke the invitation.") });
  }
});

router.patch("/team/members/:membershipId", firebaseAuth, async (req, res): Promise<void> => {
  const params = UpdateMemberParams.safeParse(req.params);
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid member update." });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding first." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("churchMemberships").doc(params.data.membershipId);
    const snap = await ref.get();
    if (!snap.exists || snap.get("churchId") !== context.churchId) {
      res.status(404).json({ error: "Member not found." });
      return;
    }
    const currentRole = normalizeRole(snap.get("role"));
    const hasPastor = await churchHasPastor(context.churchId);
    if (
      !canManageMember({
        actor: context,
        actorUid: user.uid,
        targetUid: snap.get("uid"),
        targetRole: currentRole,
        newRole: parsed.data.role,
        churchHasPastor: hasPastor,
      })
    ) {
      res.status(403).json({
        error:
          snap.get("uid") === user.uid
            ? "You can't change your own access. Ask another pastor or admin."
            : "Only a pastor can change a pastor's access or make someone a pastor.",
      });
      return;
    }
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid };
    // Rewrite legacy roles (owner, counsellor…) in their simplified form on any change.
    if (parsed.data.role !== undefined || currentRole !== snap.get("role")) {
      update.role = parsed.data.role ?? currentRole;
    }
    if (parsed.data.department !== undefined) update.department = parsed.data.department?.trim() || null;
    if (parsed.data.active !== undefined) update.active = parsed.data.active;

    // Access. Sending permissions sets them; changing the role alone resets them to the
    // new role's defaults. Only pastors can add care access (requests, the calendar).
    const newRole = (update.role as typeof currentRole) ?? currentRole ?? "staff";
    const before = permissionsFor(currentRole ?? "staff", snap.get("permissions"));
    let after: Permission[] | null = null; // null = unchanged
    if (newRole === "pastor") {
      if (newRole !== currentRole) update.permissions = FieldValue.delete();
    } else if (parsed.data.permissions !== undefined) {
      after = cleanPermissions(parsed.data.permissions);
      const refused = forbiddenCareGrants(context, hasPastor, before, after);
      if (refused.length) {
        res.status(403).json({ error: careRefusal(refused) });
        return;
      }
      const matchesDefaults =
        after.length === ROLE_DEFAULTS[newRole].length && after.every((p) => ROLE_DEFAULTS[newRole].includes(p));
      update.permissions = matchesDefaults ? FieldValue.delete() : after;
    } else if (parsed.data.role !== undefined && parsed.data.role !== currentRole) {
      const defaults = [...ROLE_DEFAULTS[newRole]];
      after = defaults.filter((p) => !forbiddenCareGrants(context, hasPastor, before, [p]).length);
      update.permissions = after.length === defaults.length ? FieldValue.delete() : after;
    }
    const targetUid = String(snap.get("uid"));
    const lockRef = db.collection(MEMBERSHIP_LOCKS).doc(targetUid);
    try {
      await db.runTransaction(async (tx) => {
        const lock = await tx.get(lockRef);
        tx.update(ref, update);
        if (parsed.data.active === false && lock.get("churchId") === context.churchId) {
          tx.delete(lockRef); // frees the person to join or create another workspace
        } else if (parsed.data.active === true && snap.get("active") !== true) {
          tx.create(lockRef, { churchId: context.churchId, role: update.role ?? snap.get("role") });
        } else if (update.role !== undefined && lock.exists) {
          tx.update(lockRef, { role: update.role });
        }
      });
    } catch (error) {
      if (isAlreadyExists(error)) {
        res.status(409).json({ error: "This person now belongs to another church workspace." });
        return;
      }
      throw error;
    }
    await audit(context.churchId, user.uid, "member_updated", ref.id, {
      fromRole: snap.get("role"),
      toRole: update.role ?? snap.get("role"),
      active: parsed.data.active ?? snap.get("active"),
      ...(after ? { fromAccess: before, toAccess: after } : {}),
    });
    const saved = await ref.get();
    const profiles = await profilesFor([String(saved.get("uid"))]);
    const who = profiles.get(String(saved.get("uid")))?.email ?? "A team member";
    const change =
      parsed.data.active === false
        ? `${who} no longer has access.`
        : parsed.data.active === true && snap.get("active") !== true
          ? `${who}'s access was restored.`
          : parsed.data.role !== undefined && parsed.data.role !== currentRole
            ? `${who} is now ${ROLE_NAMES[parsed.data.role]}.`
            : after && (after.length !== before.length || after.some((p) => !before.includes(p)))
              ? `${who}'s access changed: ${after.length ? after.map((p) => AREA_NAMES[p]).join(", ") : "own tasks only"}.`
              : null;
    if (change) await tellPastors(context.churchId, `member_${ref.id}_${Date.now()}`, change);
    res.json(
      UpdateMemberResponse.parse(
        memberResponse(saved.id, saved.data() ?? {}, profiles.get(String(saved.get("uid"))), user.uid),
      ),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to update this member.") });
  }
});

export default router;
