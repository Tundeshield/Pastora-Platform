import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { getFirebaseServices } from "./firebase-admin";
import { membershipDocId, type ChurchRole } from "./pastora-data";
import { normalizeEmail, slugify } from "./policies";

export type WorkspaceInput = {
  pastorName: string;
  churchName: string;
  phone?: string | null;
  country: string;
  timeZone: string;
  theme: "warm-cream" | "modern-cool" | "system";
};

export type CreatedWorkspace = {
  churchId: string;
  church: DocumentData;
  created: boolean;
};

export class WorkspaceConflictError extends Error {}

const MAX_SLUG_ATTEMPTS = 50;

/**
 * Creates the church workspace, owner membership, settings, subscription record and
 * slug reservation in a single Firestore transaction.
 *
 * - Idempotent: if the user already owns a workspace (e.g. a retried request after a
 *   network failure), the existing workspace is returned instead of a duplicate.
 * - Slugs are reserved with `churchSlugs/{slug}` documents inside the transaction, so
 *   two churches can never receive the same public URL.
 * - The owner role is decided here on the server; nothing from the client can set it.
 */
export async function createWorkspaceForUser(
  user: { uid: string; email?: string },
  input: WorkspaceInput,
): Promise<CreatedWorkspace> {
  try {
    return await createWorkspaceOnce(user, input);
  } catch (error) {
    // Another request for the same user won the race to create the membership lock.
    // Return the workspace it created instead of failing or duplicating.
    if (isAlreadyExists(error)) {
      const { db } = getFirebaseServices();
      const lock = await db.collection(MEMBERSHIP_LOCKS).doc(user.uid).get();
      const churchId = lock.get("churchId");
      if (typeof churchId === "string") {
        const church = await db.collection("churches").doc(churchId).get();
        if (church.exists && church.get("ownerUid") === user.uid) {
          return { churchId, church: church.data() ?? {}, created: false };
        }
      }
      throw new WorkspaceConflictError("This account already belongs to a church workspace.");
    }
    throw error;
  }
}

/**
 * One document per person (`membershipLocks/{uid}`) records the single church they
 * belong to. It is written with create(), which Firestore rejects at commit time if
 * the document already exists — so concurrent onboarding or invitation requests can
 * never give one person two workspaces, even under real contention.
 */
export const MEMBERSHIP_LOCKS = "membershipLocks";

export function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

async function createWorkspaceOnce(
  user: { uid: string; email?: string },
  input: WorkspaceInput,
): Promise<CreatedWorkspace> {
  const { db } = getFirebaseServices();
  const baseSlug = slugify(input.churchName);

  return db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(user.uid);
    const userSnap = await tx.get(userRef);
    const activeMemberships = await tx.get(
      db.collection("churchMemberships").where("uid", "==", user.uid).where("active", "==", true).limit(1),
    );

    const existingChurchId = userSnap.get("primaryChurchId");
    if (typeof existingChurchId === "string") {
      const existingChurch = await tx.get(db.collection("churches").doc(existingChurchId));
      if (existingChurch.exists && existingChurch.get("ownerUid") === user.uid) {
        return { churchId: existingChurchId, church: existingChurch.data() ?? {}, created: false };
      }
    }
    if (!activeMemberships.empty) {
      const membership = activeMemberships.docs[0];
      if (membership.get("role") === "owner") {
        const owned = await tx.get(db.collection("churches").doc(String(membership.get("churchId"))));
        if (owned.exists && owned.get("ownerUid") === user.uid) {
          return { churchId: owned.id, church: owned.data() ?? {}, created: false };
        }
      }
      throw new WorkspaceConflictError("This account already belongs to a church workspace.");
    }

    let slug: string | null = null;
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS && !slug; attempt += 1) {
      const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
      const reservation = await tx.get(db.collection("churchSlugs").doc(candidate));
      if (!reservation.exists) slug = candidate;
    }
    if (!slug) throw new Error("Could not reserve a unique address for this church. Try a different name.");

    const churchRef = db.collection("churches").doc();
    const now = FieldValue.serverTimestamp();
    const theme = input.theme === "modern-cool" ? "modern-cool" : "warm-cream";
    const church = {
      name: input.churchName.trim(),
      slug,
      phone: input.phone ?? null,
      country: input.country.trim(),
      timeZone: input.timeZone.trim(),
      logoUrl: null,
      ownerUid: user.uid,
      status: "active",
      subscriptionStatus: "setup_required",
      createdAt: now,
      updatedAt: now,
    };

    tx.create(db.collection(MEMBERSHIP_LOCKS).doc(user.uid), { churchId: churchRef.id, role: "owner", createdAt: now });
    tx.create(db.collection("churchSlugs").doc(slug), { churchId: churchRef.id, createdAt: now });
    tx.set(churchRef, church);
    tx.set(db.collection("churchMemberships").doc(membershipDocId(churchRef.id, user.uid)), {
      churchId: churchRef.id,
      uid: user.uid,
      role: "owner",
      department: null,
      active: true,
      createdAt: now,
    });
    tx.set(db.collection("churchSettings").doc(churchRef.id), {
      churchId: churchRef.id,
      theme,
      welcomeMessage: "You are welcome to reach out. Our pastoral care team is here to listen.",
      emergencyNotice:
        "Pastora is not an emergency response service or a replacement for professional healthcare.",
      appointmentDurationMinutes: 45,
      appointmentEnabled: true,
      publicPortalEnabled: true,
      categories: ["General", "Family", "Health", "Guidance"],
      retentionDays: 0,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(db.collection("subscriptions").doc(churchRef.id), {
      churchId: churchRef.id,
      planId: "starter",
      status: "setup_required",
      billingProvider: null,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(
      userRef,
      {
        uid: user.uid,
        name: input.pastorName.trim(),
        email: user.email ?? "",
        primaryChurchId: churchRef.id,
        updatedAt: now,
      },
      { merge: true },
    );
    tx.set(db.collection("auditLogs").doc(), {
      churchId: churchRef.id,
      actorUid: user.uid,
      action: "workspace_created",
      recordId: churchRef.id,
      createdAt: now,
    });
    return { churchId: churchRef.id, church, created: true };
  });
}

/**
 * Accepts the oldest pending invitation for a verified email. Returns true when a
 * membership was created. Requiring a verified email prevents anyone from claiming an
 * invitation by registering with someone else's address.
 */
export async function acceptPendingInvitation(user: {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}): Promise<boolean> {
  if (!user.email || user.email_verified !== true) return false;
  const { db } = getFirebaseServices();
  const email = normalizeEmail(user.email);
  const pending = await db
    .collection("churchInvitations")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .get();
  if (pending.empty) return false;
  const oldest = [...pending.docs].sort(
    (a, b) => (a.get("createdAt")?.toMillis?.() ?? 0) - (b.get("createdAt")?.toMillis?.() ?? 0),
  )[0];

  try {
    return await acceptInvitationOnce(user, oldest.ref);
  } catch (error) {
    if (isAlreadyExists(error)) return false; // already joined a church concurrently
    throw error;
  }
}

async function acceptInvitationOnce(
  user: { uid: string; email?: string; name?: string },
  inviteRef: FirebaseFirestore.DocumentReference,
): Promise<boolean> {
  const { db } = getFirebaseServices();
  return db.runTransaction(async (tx) => {
    const invite = await tx.get(inviteRef);
    const existing = await tx.get(
      db.collection("churchMemberships").where("uid", "==", user.uid).where("active", "==", true).limit(1),
    );
    if (!invite.exists || invite.get("status") !== "pending" || !existing.empty) return false;
    const churchId = invite.get("churchId") as string;
    const role = invite.get("role") as ChurchRole;
    if (role === "owner") return false;
    const now = FieldValue.serverTimestamp();
    tx.create(db.collection(MEMBERSHIP_LOCKS).doc(user.uid), { churchId, role, createdAt: now });
    tx.set(db.collection("churchMemberships").doc(membershipDocId(churchId, user.uid)), {
      churchId,
      uid: user.uid,
      role,
      department: invite.get("department") ?? null,
      active: true,
      invitedBy: invite.get("invitedBy") ?? null,
      createdAt: now,
    });
    tx.update(invite.ref, { status: "accepted", acceptedBy: user.uid, acceptedAt: now });
    tx.set(
      db.collection("users").doc(user.uid),
      {
        uid: user.uid,
        email: user.email,
        name: user.name ?? user.email?.split("@")[0] ?? "Pastora user",
        updatedAt: now,
      },
      { merge: true },
    );
    tx.set(db.collection("auditLogs").doc(), {
      churchId,
      actorUid: user.uid,
      action: "invitation_accepted",
      recordId: invite.id,
      role,
      createdAt: now,
    });
    return true;
  });
}

export async function hasPendingInvitation(email: string | undefined): Promise<boolean> {
  if (!email) return false;
  const { db } = getFirebaseServices();
  const pending = await db
    .collection("churchInvitations")
    .where("email", "==", normalizeEmail(email))
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return !pending.empty;
}
