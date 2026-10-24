/**
 * Pastora Admin console: for Pastora's own administrators, never for churches.
 *
 * It manages workspaces and accounts — pause a church, disable an account, fix a
 * church's roles — but deliberately reads nothing from pastoral care, appointments,
 * reports or expenses. Even Pastora cannot read a church's care records here.
 * Every action is written to platformAuditLogs.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetPlatformWorkspaceParams,
  GetPlatformWorkspaceResponse,
  ListPlatformAuditResponse,
  ListPlatformUsersResponse,
  ListPlatformWorkspacesResponse,
  UpdatePlatformMemberBody,
  UpdatePlatformMemberParams,
  UpdatePlatformMemberResponse,
  UpdatePlatformUserBody,
  UpdatePlatformUserParams,
  UpdatePlatformUserResponse,
  UpdatePlatformWorkspaceBody,
  UpdatePlatformWorkspaceParams,
  UpdatePlatformWorkspaceResponse,
} from "@workspace/api-zod";
import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { FieldValue, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  audit,
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  iso,
  membershipDocId,
  normalizeRole,
  notifyChurchRoles,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { isPlatformAdmin } from "../lib/policies";

const router: IRouter = Router();

function requirePlatformAdmin(req: Request, res: Response): DecodedIdToken | null {
  const user = authenticatedUser(req);
  if (!isPlatformAdmin(user)) {
    res.status(403).json({ error: "Pastora administrator access is required." });
    return null;
  }
  return user;
}

async function platformAudit(
  actor: DecodedIdToken,
  action: string,
  target: string,
  details: string | null = null,
): Promise<void> {
  await getFirebaseServices().db.collection("platformAuditLogs").add({
    actorUid: actor.uid,
    actorEmail: actor.email ?? "",
    action,
    target,
    details,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function fail(res: Response, error: unknown, fallback: string): void {
  if (failFirebaseSetup(res, error)) return;
  res.status(400).json({ error: errorMessage(error, fallback) });
}

/** Firebase Auth records for these uids, fetched in batches of 100. */
async function authRecords(uids: string[]): Promise<Map<string, UserRecord>> {
  const { auth } = getFirebaseServices();
  const found = new Map<string, UserRecord>();
  for (let i = 0; i < uids.length; i += 100) {
    const result = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const record of result.users) found.set(record.uid, record);
  }
  return found;
}

async function activeMemberCounts(): Promise<Map<string, number>> {
  const { db } = getFirebaseServices();
  const memberships = await db.collection("churchMemberships").where("active", "==", true).get();
  const counts = new Map<string, number>();
  for (const doc of memberships.docs) {
    const churchId = String(doc.get("churchId"));
    counts.set(churchId, (counts.get(churchId) ?? 0) + 1);
  }
  return counts;
}

async function creatorEmail(church: DocumentData): Promise<string | null> {
  if (typeof church.createdByEmail === "string") return church.createdByEmail;
  if (typeof church.ownerUid !== "string") return null;
  const profile = await getFirebaseServices().db.collection("users").doc(church.ownerUid).get();
  return typeof profile.get("email") === "string" ? profile.get("email") : null;
}

async function workspaceSummary(snap: DocumentSnapshot, memberCount: number) {
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    name: String(data.name ?? "Unnamed church"),
    slug: String(data.slug ?? ""),
    country: String(data.country ?? "Not set"),
    status: data.status === "suspended" ? "suspended" : "active",
    memberCount,
    createdByEmail: await creatorEmail(data),
    createdAt: iso(data.createdAt),
  };
}

async function workspaceDetail(churchId: string) {
  const { db } = getFirebaseServices();
  const church = await db.collection("churches").doc(churchId).get();
  if (!church.exists) return null;
  const memberships = await db.collection("churchMemberships").where("churchId", "==", churchId).get();
  const uids = memberships.docs.map((doc) => String(doc.get("uid")));
  const [records, profiles] = await Promise.all([
    authRecords(uids),
    uids.length ? db.getAll(...uids.map((uid) => db.collection("users").doc(uid))) : Promise.resolve([]),
  ]);
  const profileOf = new Map(profiles.map((snap) => [snap.id, snap.data() ?? {}]));
  const members = memberships.docs.map((doc) => {
    const uid = String(doc.get("uid"));
    const record = records.get(uid);
    const profile = profileOf.get(uid) ?? {};
    return {
      uid,
      name: String(profile.name ?? record?.displayName ?? record?.email?.split("@")[0] ?? "Member"),
      email: String(record?.email ?? profile.email ?? ""),
      role: normalizeRole(doc.get("role")) ?? "staff",
      active: doc.get("active") === true,
      disabled: record?.disabled === true,
    };
  });
  const activeCount = members.filter((member) => member.active).length;
  return { workspace: await workspaceSummary(church, activeCount), members };
}

router.get("/platform/workspaces", firebaseAuth, async (req, res): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { db } = getFirebaseServices();
    const [churches, counts] = await Promise.all([db.collection("churches").limit(1000).get(), activeMemberCounts()]);
    const list = await Promise.all(churches.docs.map((doc) => workspaceSummary(doc, counts.get(doc.id) ?? 0)));
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(ListPlatformWorkspacesResponse.parse(list));
  } catch (error) {
    fail(res, error, "Unable to load workspaces.");
  }
});

router.get("/platform/workspaces/:churchId", firebaseAuth, async (req, res): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  const params = GetPlatformWorkspaceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid workspace." });
    return;
  }
  try {
    const detail = await workspaceDetail(params.data.churchId);
    if (!detail) {
      res.status(404).json({ error: "Workspace not found." });
      return;
    }
    res.json(GetPlatformWorkspaceResponse.parse(detail));
  } catch (error) {
    fail(res, error, "Unable to load this workspace.");
  }
});

router.patch("/platform/workspaces/:churchId", firebaseAuth, async (req, res): Promise<void> => {
  const actor = requirePlatformAdmin(req, res);
  if (!actor) return;
  const params = UpdatePlatformWorkspaceParams.safeParse(req.params);
  const body = UpdatePlatformWorkspaceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose active or suspended." });
    return;
  }
  try {
    const { db } = getFirebaseServices();
    const ref = db.collection("churches").doc(params.data.churchId);
    const church = await ref.get();
    if (!church.exists) {
      res.status(404).json({ error: "Workspace not found." });
      return;
    }
    const reason = body.data.reason?.trim() || null;
    await ref.update({
      status: body.data.status,
      statusReason: reason,
      statusChangedAt: FieldValue.serverTimestamp(),
      statusChangedBy: actor.uid,
    });
    await platformAudit(
      actor,
      body.data.status === "suspended" ? "workspace_suspended" : "workspace_reactivated",
      String(church.get("name") ?? church.id),
      reason,
    );
    const counts = await activeMemberCounts();
    res.json(UpdatePlatformWorkspaceResponse.parse(await workspaceSummary(await ref.get(), counts.get(ref.id) ?? 0)));
  } catch (error) {
    fail(res, error, "Unable to update this workspace.");
  }
});

router.patch(
  "/platform/workspaces/:churchId/members/:uid",
  firebaseAuth,
  async (req, res): Promise<void> => {
    const actor = requirePlatformAdmin(req, res);
    if (!actor) return;
    const params = UpdatePlatformMemberParams.safeParse(req.params);
    const body = UpdatePlatformMemberBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Choose a role." });
      return;
    }
    try {
      const { db } = getFirebaseServices();
      const { churchId, uid } = params.data;
      const ref = db.collection("churchMemberships").doc(membershipDocId(churchId, uid));
      const snap = await ref.get();
      if (!snap.exists || snap.get("churchId") !== churchId) {
        res.status(404).json({ error: "This person is not a member of the workspace." });
        return;
      }
      const fromRole = normalizeRole(snap.get("role"));
      await db.runTransaction(async (tx) => {
        const lockRef = db.collection("membershipLocks").doc(uid);
        const lock = await tx.get(lockRef);
        tx.update(ref, { role: body.data.role, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });
        if (lock.exists && lock.get("churchId") === churchId) tx.update(lockRef, { role: body.data.role });
      });
      const detail = await workspaceDetail(churchId);
      const email = detail?.members.find((member) => member.uid === uid)?.email ?? uid;
      await audit(churchId, actor.uid, "member_updated_by_pastora", ref.id, { fromRole, toRole: body.data.role });
      await platformAudit(
        actor,
        "member_role_changed",
        `${email} in ${detail?.workspace.name ?? churchId}`,
        `${fromRole ?? "unknown"} → ${body.data.role}`,
      );
      await notifyChurchRoles(
        churchId,
        `pastora_${ref.id}_${Date.now()}`,
        "team",
        `Pastora support changed ${email} to ${body.data.role}.`,
        "/app/team",
        ["pastor", "admin"],
      ).catch(() => undefined);
      res.json(UpdatePlatformMemberResponse.parse(detail));
    } catch (error) {
      fail(res, error, "Unable to change this role.");
    }
  },
);

router.get("/platform/users", firebaseAuth, async (req, res): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { auth, db } = getFirebaseServices();
    const records: UserRecord[] = [];
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      records.push(...page.users);
      pageToken = page.pageToken;
    } while (pageToken && records.length < 10_000);

    const [memberships, churches] = await Promise.all([
      db.collection("churchMemberships").where("active", "==", true).get(),
      db.collection("churches").limit(1000).get(),
    ]);
    const churchName = new Map(churches.docs.map((doc) => [doc.id, String(doc.get("name") ?? "")]));
    const membershipOf = new Map(memberships.docs.map((doc) => [String(doc.get("uid")), doc.data()]));
    const list = records.map((record) => {
      const membership = membershipOf.get(record.uid);
      const churchId = typeof membership?.churchId === "string" ? membership.churchId : null;
      return {
        uid: record.uid,
        email: record.email ?? "",
        name: record.displayName ?? null,
        emailVerified: record.emailVerified === true,
        disabled: record.disabled === true,
        createdAt: record.metadata?.creationTime ? new Date(record.metadata.creationTime).toISOString() : null,
        lastSignInAt: record.metadata?.lastSignInTime
          ? new Date(record.metadata.lastSignInTime).toISOString()
          : null,
        churchId,
        churchName: churchId ? (churchName.get(churchId) ?? null) : null,
        role: membership ? normalizeRole(membership.role) : null,
        platformAdmin: isPlatformAdmin({
          email: record.email,
          email_verified: record.emailVerified,
          platformAdmin: record.customClaims?.platformAdmin,
        }),
      };
    });
    list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    res.json(ListPlatformUsersResponse.parse(list));
  } catch (error) {
    fail(res, error, "Unable to load accounts.");
  }
});

router.patch("/platform/users/:uid", firebaseAuth, async (req, res): Promise<void> => {
  const actor = requirePlatformAdmin(req, res);
  if (!actor) return;
  const params = UpdatePlatformUserParams.safeParse(req.params);
  const body = UpdatePlatformUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid account update." });
    return;
  }
  if (params.data.uid === actor.uid) {
    res.status(400).json({ error: "You can't disable your own account." });
    return;
  }
  try {
    const { auth } = getFirebaseServices();
    const existing = await auth.getUser(params.data.uid).catch(() => null);
    if (!existing) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    await auth.updateUser(existing.uid, { disabled: body.data.disabled });
    // Signs the person out everywhere; with checkRevoked their current session ends now.
    if (body.data.disabled) await auth.revokeRefreshTokens(existing.uid);
    await platformAudit(actor, body.data.disabled ? "account_disabled" : "account_enabled", existing.email ?? existing.uid);
    const record = await auth.getUser(existing.uid);
    const { db } = getFirebaseServices();
    const membership = await db
      .collection("churchMemberships")
      .where("uid", "==", record.uid)
      .where("active", "==", true)
      .limit(1)
      .get();
    const data = membership.docs[0]?.data();
    const churchId = typeof data?.churchId === "string" ? data.churchId : null;
    const church = churchId ? await db.collection("churches").doc(churchId).get() : null;
    res.json(
      UpdatePlatformUserResponse.parse({
        uid: record.uid,
        email: record.email ?? "",
        name: record.displayName ?? null,
        emailVerified: record.emailVerified === true,
        disabled: record.disabled === true,
        createdAt: record.metadata?.creationTime ? new Date(record.metadata.creationTime).toISOString() : null,
        lastSignInAt: record.metadata?.lastSignInTime
          ? new Date(record.metadata.lastSignInTime).toISOString()
          : null,
        churchId,
        churchName: church?.exists ? String(church.get("name") ?? "") : null,
        role: data ? normalizeRole(data.role) : null,
        platformAdmin: isPlatformAdmin({
          email: record.email,
          email_verified: record.emailVerified,
          platformAdmin: record.customClaims?.platformAdmin,
        }),
      }),
    );
  } catch (error) {
    fail(res, error, "Unable to update this account.");
  }
});

router.get("/platform/audit", firebaseAuth, async (req, res): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { db } = getFirebaseServices();
    // Small collection; sorted here so no composite index is needed.
    const entries = await db.collection("platformAuditLogs").limit(2000).get();
    const newest = [...entries.docs]
      .sort((a, b) => iso(b.get("createdAt")).localeCompare(iso(a.get("createdAt"))))
      .slice(0, 100);
    res.json(
      ListPlatformAuditResponse.parse(
        newest.map((doc) => ({
          id: doc.id,
          action: String(doc.get("action")),
          actorEmail: String(doc.get("actorEmail") ?? ""),
          target: String(doc.get("target") ?? ""),
          details: doc.get("details") ?? null,
          createdAt: iso(doc.get("createdAt")),
        })),
      ),
    );
  } catch (error) {
    fail(res, error, "Unable to load the activity log.");
  }
});

export default router;
