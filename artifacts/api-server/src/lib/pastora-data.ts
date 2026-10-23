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

export type ChurchRole =
  | "owner"
  | "pastor"
  | "counsellor"
  | "staff"
  | "department_leader"
  | "finance";

export type TenantContext = {
  churchId: string;
  role: ChurchRole;
  membership: DocumentData;
};

export function authenticatedUser(req: Request): DecodedIdToken | null {
  return req.pastoraUser ?? null;
}

export async function tenantFor(req: Request): Promise<TenantContext | null> {
  const user = authenticatedUser(req);
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
  const role = membership.role;
  if (
    typeof churchId !== "string" ||
    !["owner", "pastor", "counsellor", "staff", "department_leader", "finance"].includes(role)
  ) {
    throw new Error("The church membership is invalid.");
  }
  return { churchId, role: role as ChurchRole, membership };
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
  return false;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function notifyChurchRoles(
  churchId: string,
  eventId: string,
  type: "pastoral_request" | "appointment" | "follow_up" | "task" | "report" | "expense",
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
    if (!roles.includes(data.role as ChurchRole) || typeof data.uid !== "string") continue;
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
  type: "pastoral_request" | "appointment" | "follow_up" | "task" | "report" | "expense",
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
