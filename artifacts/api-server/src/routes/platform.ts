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
  CreatePlatformModuleBody,
  CreatePlatformModuleResponse,
  DeletePlatformModuleParams,
  GetPlatformWorkspaceParams,
  ListPlatformModulesResponse,
  UpdatePlatformModuleBody,
  UpdatePlatformModuleParams,
  UpdatePlatformModuleResponse,
  UpdatePlatformSettingsBody,
  UpdatePlatformSettingsResponse,
  UpdatePlatformWorkspaceAccessBody,
  UpdatePlatformWorkspaceAccessParams,
  UpdatePlatformWorkspaceAccessResponse,
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
import {
  CHURCH_MODULES,
  MODULE_INTEREST,
  MODULE_SUGGESTIONS,
  MODULES,
  churchAccess,
  getPlatformSettings,
  loadCatalog,
  moduleFrom,
  moduleState,
  setEarlyAccess,
} from "../lib/modules";

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
  const access = await churchAccess(churchId);
  return {
    workspace: await workspaceSummary(church, activeCount),
    members,
    plan: access.plan,
    grants: access.grants,
  };
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

/* ---------------------------------------------------------------- Modules ---- */

async function platformModules() {
  const { db } = getFirebaseServices();
  const [catalog, settings, churches, churchModuleDocs, subscriptions, interest, suggestions] = await Promise.all([
    loadCatalog(),
    getPlatformSettings(),
    db.collection("churches").limit(1000).get(),
    db.collection(CHURCH_MODULES).get(),
    db.collection("subscriptions").get(),
    db.collection(MODULE_INTEREST).get(),
    db.collection(MODULE_SUGGESTIONS).limit(500).get(),
  ]);
  const churchName = new Map(churches.docs.map((doc) => [doc.id, String(doc.get("name") ?? "")]));
  const settingsOf = new Map(churchModuleDocs.docs.map((doc) => [doc.id, doc.data()]));
  const planOf = new Map(subscriptions.docs.map((doc) => [doc.id, doc.get("planId")]));
  const counts = new Map(catalog.map((m) => [m.id, { active: 0, interested: 0, granted: 0 }]));
  for (const church of churches.docs) {
    if (church.get("status") === "suspended") continue;
    const stored = settingsOf.get(church.id) ?? {};
    const access = {
      plan: (["starter", "church", "plus"].includes(planOf.get(church.id)) ? planOf.get(church.id) : "starter") as
        | "starter"
        | "church"
        | "plus",
      grants: Array.isArray(stored.grants) ? stored.grants.map(String) : [],
      enabled: (stored.enabled as Record<string, boolean>) ?? {},
      interested: new Set<string>(),
    };
    for (const module of catalog) {
      const state = moduleState(module, access, settings.earlyAccess);
      const count = counts.get(module.id)!;
      if (state.active) count.active += 1;
      if (state.granted) count.granted += 1;
    }
  }
  for (const doc of interest.docs) {
    const count = counts.get(String(doc.get("moduleId")));
    if (count && churchName.has(String(doc.get("churchId")))) count.interested += 1;
  }
  return {
    earlyAccess: settings.earlyAccess,
    modules: catalog.map(({ defaultEnabled: _d, ...m }) => ({
      ...m,
      activeChurches: counts.get(m.id)!.active,
      interestedChurches: counts.get(m.id)!.interested,
      grantedChurches: counts.get(m.id)!.granted,
    })),
    suggestions: [...suggestions.docs]
      .sort((a, b) => iso(b.get("createdAt")).localeCompare(iso(a.get("createdAt"))))
      .slice(0, 100)
      .map((doc) => ({
        id: doc.id,
        text: String(doc.get("text") ?? ""),
        churchName: churchName.get(String(doc.get("churchId"))) ?? "Unknown church",
        email: String(doc.get("email") ?? ""),
        createdAt: iso(doc.get("createdAt")),
      })),
  };
}

async function platformModule(id: string) {
  return (await platformModules()).modules.find((m) => m.id === id);
}

router.get("/platform/modules", firebaseAuth, async (req, res): Promise<void> => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    res.json(ListPlatformModulesResponse.parse(await platformModules()));
  } catch (error) {
    fail(res, error, "Unable to load modules.");
  }
});

router.post("/platform/modules", firebaseAuth, async (req, res): Promise<void> => {
  const actor = requirePlatformAdmin(req, res);
  if (!actor) return;
  const body = CreatePlatformModuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Give the module an id (lowercase letters, numbers and dashes), a name and a description." });
    return;
  }
  try {
    const { db } = getFirebaseServices();
    await loadCatalog(); // make sure the defaults are seeded first
    const ref = db.collection(MODULES).doc(body.data.id);
    const { id, ...fields } = body.data;
    try {
      await ref.create({
        ...fields,
        roles: fields.roles ?? ["pastor"],
        priceNote: fields.priceNote?.trim() || null,
        sortOrder: fields.sortOrder ?? 500,
        defaultEnabled: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 6 || code === "already-exists" || /exists/i.test(String(error))) {
        res.status(409).json({ error: "A module with this id already exists." });
        return;
      }
      throw error;
    }
    await platformAudit(actor, "module_created", body.data.name, `id ${id}, ${body.data.status}`);
    res.status(201).json(CreatePlatformModuleResponse.parse(await platformModule(id)));
  } catch (error) {
    fail(res, error, "Unable to create the module.");
  }
});

router.patch("/platform/modules/:moduleId", firebaseAuth, async (req, res): Promise<void> => {
  const actor = requirePlatformAdmin(req, res);
  if (!actor) return;
  const params = UpdatePlatformModuleParams.safeParse(req.params);
  const body = UpdatePlatformModuleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid module update." });
    return;
  }
  try {
    const { db } = getFirebaseServices();
    await loadCatalog();
    const ref = db.collection(MODULES).doc(params.data.moduleId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Module not found." });
      return;
    }
    const before = moduleFrom(snap.id, snap.data());
    const update: Record<string, unknown> = { ...body.data, updatedAt: FieldValue.serverTimestamp() };
    if (body.data.priceNote !== undefined) update.priceNote = body.data.priceNote?.trim() || null;
    // Built-in modules are backed by product code; "coming soon" would hide working features.
    if (before.builtin && body.data.status === "coming_soon") {
      res.status(400).json({ error: "A built-in module can be available, beta or retired." });
      return;
    }
    await ref.update(update);
    const changes = Object.keys(body.data).join(", ");
    await platformAudit(actor, "module_updated", before.name, changes || null);
    res.json(UpdatePlatformModuleResponse.parse(await platformModule(params.data.moduleId)));
  } catch (error) {
    fail(res, error, "Unable to update the module.");
  }
});

router.delete("/platform/modules/:moduleId", firebaseAuth, async (req, res): Promise<void> => {
  const actor = requirePlatformAdmin(req, res);
  if (!actor) return;
  const params = DeletePlatformModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid module." });
    return;
  }
  try {
    const { db } = getFirebaseServices();
    await loadCatalog();
    const ref = db.collection(MODULES).doc(params.data.moduleId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Module not found." });
      return;
    }
    const module = moduleFrom(snap.id, snap.data());
    if (module.builtin) {
      res.status(400).json({
        error: "Built-in modules hold churches' records, so they can be retired (hidden and switched off) but not deleted.",
      });
      return;
    }
    const interest = await db.collection(MODULE_INTEREST).where("moduleId", "==", module.id).get();
    const batch = db.batch();
    batch.delete(ref);
    for (const doc of interest.docs) batch.delete(doc.ref);
    await batch.commit();
    await platformAudit(actor, "module_deleted", module.name);
    res.sendStatus(204);
  } catch (error) {
    fail(res, error, "Unable to delete the module.");
  }
});

router.patch("/platform/settings", firebaseAuth, async (req, res): Promise<void> => {
  const actor = requirePlatformAdmin(req, res);
  if (!actor) return;
  const body = UpdatePlatformSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid settings." });
    return;
  }
  try {
    const saved = await setEarlyAccess(body.data.earlyAccess);
    await platformAudit(actor, body.data.earlyAccess ? "early_access_on" : "early_access_off", "All churches");
    res.json(UpdatePlatformSettingsResponse.parse(saved));
  } catch (error) {
    fail(res, error, "Unable to update settings.");
  }
});

router.patch("/platform/workspaces/:churchId/access", firebaseAuth, async (req, res): Promise<void> => {
  const actor = requirePlatformAdmin(req, res);
  if (!actor) return;
  const params = UpdatePlatformWorkspaceAccessParams.safeParse(req.params);
  const body = UpdatePlatformWorkspaceAccessBody.safeParse(req.body);
  if (!params.success || !body.success || (body.data.plan === undefined && body.data.grants === undefined)) {
    res.status(400).json({ error: "Choose a plan or modules to grant." });
    return;
  }
  try {
    const { db } = getFirebaseServices();
    const { churchId } = params.data;
    const church = await db.collection("churches").doc(churchId).get();
    if (!church.exists) {
      res.status(404).json({ error: "Workspace not found." });
      return;
    }
    const details: string[] = [];
    if (body.data.plan !== undefined) {
      await db
        .collection("subscriptions")
        .doc(churchId)
        .set({ churchId, planId: body.data.plan, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      details.push(`plan ${body.data.plan}`);
    }
    if (body.data.grants !== undefined) {
      const known = new Set((await loadCatalog()).map((m) => m.id));
      const grants = [...new Set(body.data.grants)].filter((id) => known.has(id));
      await db
        .collection(CHURCH_MODULES)
        .doc(churchId)
        .set({ churchId, grants, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      details.push(`free modules: ${grants.join(", ") || "none"}`);
    }
    await platformAudit(actor, "workspace_access_changed", String(church.get("name") ?? churchId), details.join("; "));
    res.json(UpdatePlatformWorkspaceAccessResponse.parse(await workspaceDetail(churchId)));
  } catch (error) {
    fail(res, error, "Unable to update this church's access.");
  }
});

export default router;
