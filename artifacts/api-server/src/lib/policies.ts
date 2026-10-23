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
