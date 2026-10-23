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
  hasRole,
  iso,
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { canManageMember, normalizeEmail } from "../lib/policies";
import { isAlreadyExists, MEMBERSHIP_LOCKS } from "../lib/workspace-service";

const router: IRouter = Router();

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
    role: data.role,
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
    if (!hasRole(context, ["owner", "pastor"])) {
      res.status(403).json({ error: "Only the church owner or a pastor can view the team." });
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
          role: doc.get("role"),
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
    if (!hasRole(context, ["owner"])) {
      res.status(403).json({ error: "Only the church owner can invite people and assign roles." });
      return;
    }
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
      department: parsed.data.department?.trim() || null,
      status: "pending",
      invitedBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    await audit(context.churchId, user.uid, "invitation_created", ref.id, { role: parsed.data.role });
    const saved = await ref.get();
    res.status(201).json(
      CreateInvitationResponse.parse({
        id: ref.id,
        email,
        role: parsed.data.role,
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
    if (!hasRole(context, ["owner"])) {
      res.status(403).json({ error: "Only the church owner can revoke invitations." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("churchInvitations").doc(params.data.invitationId);
    const snap = await ref.get();
    if (!snap.exists || snap.get("churchId") !== context.churchId || snap.get("status") !== "pending") {
      res.status(404).json({ error: "Invitation not found." });
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
    if (
      !canManageMember({
        actorRole: context.role,
        actorUid: user.uid,
        targetUid: snap.get("uid"),
        targetRole: snap.get("role"),
      })
    ) {
      res.status(403).json({
        error: "Only the church owner can change roles, and never their own or another owner's.",
      });
      return;
    }
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid };
    if (parsed.data.role !== undefined) update.role = parsed.data.role;
    if (parsed.data.department !== undefined) update.department = parsed.data.department?.trim() || null;
    if (parsed.data.active !== undefined) update.active = parsed.data.active;
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
        } else if (parsed.data.role !== undefined && lock.exists) {
          tx.update(lockRef, { role: parsed.data.role });
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
      toRole: parsed.data.role ?? snap.get("role"),
      active: parsed.data.active ?? snap.get("active"),
    });
    const saved = await ref.get();
    const profiles = await profilesFor([String(saved.get("uid"))]);
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
