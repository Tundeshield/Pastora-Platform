import type { ChurchRole } from "./pastora-data";

export function sameChurch(recordChurchId: unknown, activeChurchId: string): boolean {
  return typeof recordChurchId === "string" && recordChurchId === activeChurchId;
}

export function canViewCounselling(role: ChurchRole): boolean {
  return ["owner", "pastor", "counsellor"].includes(role);
}

export function canApproveExpense(
  role: ChurchRole,
  actorUid: string,
  requesterUid: unknown,
): boolean {
  return (
    ["owner", "pastor"].includes(role) &&
    typeof requesterUid === "string" &&
    requesterUid !== actorUid
  );
}

export function canRecordExpensePayment(input: {
  role: ChurchRole;
  actorUid: string;
  requesterUid: unknown;
  approverUid: unknown;
  currentStatus: unknown;
}): boolean {
  return (
    input.role === "finance" &&
    input.currentStatus === "approved" &&
    typeof input.requesterUid === "string" &&
    input.requesterUid !== input.actorUid &&
    input.approverUid !== input.actorUid
  );
}

export function appointmentTimesOverlap(
  aStart: number,
  aDurationMinutes: number,
  bStart: number,
  bDurationMinutes: number,
): boolean {
  if (
    !Number.isFinite(aStart) ||
    !Number.isFinite(bStart) ||
    !Number.isFinite(aDurationMinutes) ||
    !Number.isFinite(bDurationMinutes)
  ) {
    return false;
  }
  return (
    aStart < bStart + bDurationMinutes * 60_000 &&
    aStart + aDurationMinutes * 60_000 > bStart
  );
}

export type ExpenseStatus = "submitted" | "approved" | "rejected" | "clarification" | "paid";

/**
 * Allowed expense transitions. Decisions (approve / reject / clarification) are only
 * possible while a request is awaiting review, so an approved request can never be
 * silently reversed or re-approved; "paid" is only reachable from "approved".
 */
export function expenseTransitionAllowed(from: unknown, to: ExpenseStatus): boolean {
  const allowed: Record<string, ExpenseStatus[]> = {
    submitted: ["approved", "rejected", "clarification"],
    clarification: ["approved", "rejected"],
    approved: ["paid"],
  };
  return typeof from === "string" && (allowed[from] ?? []).includes(to);
}

export type MemberChange = {
  actorRole: ChurchRole;
  actorUid: string;
  targetUid: unknown;
  targetRole: unknown;
};

/** Only the owner manages the team, never their own membership, and never another owner. */
export function canManageMember(change: MemberChange): boolean {
  return (
    change.actorRole === "owner" &&
    typeof change.targetUid === "string" &&
    change.targetUid !== change.actorUid &&
    change.targetRole !== "owner"
  );
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56) || "church"
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
