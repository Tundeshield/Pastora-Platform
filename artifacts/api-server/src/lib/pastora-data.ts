import type { Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type Query,
} from "firebase-admin/firestore";
import {
  FirebaseSetupRequiredError,
  getFirebaseServices,
} from "./firebase-admin";
import { sameChurch } from "./policies";
import { ModuleOffError } from "./modules";

/**
 * Church roles, kept deliberately small:
 * - pastor:  pastoral care (prayer, counselling, notes), calendar, reviews, approvals, team, settings
 * - staff:   the church office — general enquiries, calendar, tasks, QR links, reports, expenses
 * - finance: records payments on approved expenses
 * - admin:   sets the workspace up — team, settings, QR links — and never sees pastoral
 *            care, the calendar, reports or expenses
 */
export type ChurchRole = "pastor" | "staff" | "finance" | "admin";

export const CHURCH_ROLES: readonly ChurchRole[] = ["pastor", "staff", "finance", "admin"];

/**
 * Maps roles stored by earlier versions. Owners and counsellors already had full
 * pastoral access, so they keep it as pastors; department leaders become staff.
 */
export function normalizeRole(role: unknown): ChurchRole | null {
  if (typeof role !== "string") return null;
  if ((CHURCH_ROLES as readonly string[]).includes(role)) return role as ChurchRole;
  if (role === "owner" || role === "counsellor") return "pastor";
  if (role === "department_leader") return "staff";
  return null;
}

export type TenantContext = {
  churchId: string;
  role: ChurchRole;
  membership: DocumentData;
};

export class ChurchSuspendedError extends Error {
  constructor() {
    super("This church workspace has been paused by Pastora. Please contact Pastora support.");
  }
}

export function authenticatedUser(req: Request): DecodedIdToken | null {
  return req.pastoraUser ?? null;
}

export async function tenantFor(req: Request): Promise<TenantContext | null> {
  return tenantForUser(authenticatedUser(req));
}

/**
 * The caller's church and role. A suspended church throws ChurchSuspendedError so no
 * route can read or change its records; the session passes allowSuspended to explain it.
 */
export async function tenantForUser(
  user: DecodedIdToken | null,
  options: { allowSuspended?: boolean } = {},
): Promise<(TenantContext & { suspended: boolean }) | null> {
  if (!user) return null;

  const { db } = getFirebaseServices();
  const memberships = await db
    .collection("churchMemberships")
    .where("uid", "==", user.uid)
    .where("active", "==", true)
    .limit(2)
    .get();

  if (memberships.empty) return null;
  if (memberships.size > 1) {
    throw new Error("Multiple active church workspaces require an explicit workspace selection.");
  }
  const membership = memberships.docs[0].data();
  const churchId = membership.churchId;
  const role = normalizeRole(membership.role);
  if (typeof churchId !== "string" || !role) {
    throw new Error("The church membership is invalid.");
  }
  const church = await db.collection("churches").doc(churchId).get();
  const suspended = church.get("status") === "suspended";
  if (suspended && !options.allowSuspended) throw new ChurchSuspendedError();
  return { churchId, role, membership, suspended };
}

/** Memberships use a deterministic id so the same person can never be added to a church twice. */
export function membershipDocId(churchId: string, uid: string): string {
  return `${churchId}_${uid}`;
}

/** Append-only audit trail for sensitive actions. Never stores request content. */
export async function audit(
  churchId: string,
  actorUid: string,
  action: string,
  recordId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { db } = getFirebaseServices();
  await db.collection("auditLogs").add({
    churchId,
    actorUid,
    action,
    recordId,
    ...details,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export function hasRole(context: TenantContext, roles: ChurchRole[]): boolean {
  return roles.includes(context.role);
}

export async function tenantDocument(
  collection: string,
  id: string,
  churchId: string,
): Promise<{ ref: DocumentReference; data: DocumentData } | null> {
  const { db } = getFirebaseServices();
  const ref = db.collection(collection).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || !sameChurch(snapshot.get("churchId"), churchId)) return null;
  return { ref, data: snapshot.data() ?? {} };
}

export async function listTenantDocuments(
  collection: string,
  churchId: string,
  limit = 250,
): Promise<DocumentData[]> {
  const { db } = getFirebaseServices();
  const query = db.collection(collection).where("churchId", "==", churchId).limit(limit) as Query;
  const result = await query.get();
  return result.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export function iso(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

export function optionalIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  return iso(value);
}

export function recordWithId(
  id: string,
  data: DocumentData,
  dateFields: string[] = ["createdAt", "updatedAt", "startAt", "dueAt"],
): DocumentData {
  const normalized: DocumentData = { id, ...data };
  for (const field of dateFields) {
    if (field in normalized) {
      normalized[field] =
        normalized[field] == null ? null : iso(normalized[field]);
    }
  }
  return normalized;
}

export function failFirebaseSetup(res: Response, error: unknown): boolean {
  if (error instanceof FirebaseSetupRequiredError) {
    res.status(503).json({ error: error.message });
    return true;
  }
  if (error instanceof ChurchSuspendedError || error instanceof ModuleOffError) {
    res.status(403).json({ error: error.message });
    return true;
  }
  return false;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export type NotificationType =
  | "pastoral_request"
  | "appointment"
  | "follow_up"
  | "task"
  | "report"
  | "expense"
  | "team";

export async function notifyChurchRoles(
  churchId: string,
  eventId: string,
  type: NotificationType,
  title: string,
  targetPath: string,
  roles: ChurchRole[],
): Promise<void> {
  const { db } = getFirebaseServices();
  const memberships = await db
    .collection("churchMemberships")
    .where("churchId", "==", churchId)
    .where("active", "==", true)
    .get();
  const batch = db.batch();
  let writes = 0;
  for (const member of memberships.docs) {
    const data = member.data();
    const role = normalizeRole(data.role);
    if (!role || !roles.includes(role) || typeof data.uid !== "string") continue;
    const ref = db
      .collection("notifications")
      .doc(`${eventId}_${data.uid}`);
    batch.set(
      ref,
      {
        churchId,
        uid: data.uid,
        type,
        title,
        targetPath,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    writes += 1;
  }
  if (writes > 0) await batch.commit();
}

export async function notifyChurchUser(
  churchId: string,
  eventId: string,
  uid: string,
  type: NotificationType,
  title: string,
  targetPath: string,
): Promise<void> {
  const { db } = getFirebaseServices();
  await db
    .collection("notifications")
    .doc(`${eventId}_${uid}`)
    .set(
      {
        churchId,
        uid,
        type,
        title,
        targetPath,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}
