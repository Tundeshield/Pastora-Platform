import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentTimesOverlap,
  canApproveExpense,
  canRecordExpensePayment,
  canViewCounselling,
  sameChurch,
} from "./policies";

test("tenant check denies cross-church identifiers", () => {
  assert.equal(sameChurch("church-a", "church-a"), true);
  assert.equal(sameChurch("church-b", "church-a"), false);
  assert.equal(sameChurch(undefined, "church-a"), false);
});

test("counselling access is restricted to pastoral care roles", () => {
  assert.equal(canViewCounselling("owner"), true);
  assert.equal(canViewCounselling("pastor"), true);
  assert.equal(canViewCounselling("counsellor"), true);
  assert.equal(canViewCounselling("staff"), false);
  assert.equal(canViewCounselling("finance"), false);
});

test("expense requester cannot approve their own request", () => {
  assert.equal(canApproveExpense("pastor", "pastor-1", "staff-1"), true);
  assert.equal(canApproveExpense("pastor", "staff-1", "staff-1"), false);
  assert.equal(canApproveExpense("finance", "finance-1", "staff-1"), false);
});

test("payment recording requires approved expense and separate finance actor", () => {
  const approvedByPastor = {
    role: "finance" as const,
    actorUid: "finance-1",
    requesterUid: "staff-1",
    approverUid: "pastor-1",
    currentStatus: "approved",
  };
  assert.equal(canRecordExpensePayment(approvedByPastor), true);
  assert.equal(
    canRecordExpensePayment({ ...approvedByPastor, currentStatus: "submitted" }),
    false,
  );
  assert.equal(
    canRecordExpensePayment({ ...approvedByPastor, actorUid: "pastor-1" }),
    false,
  );
  assert.equal(
    canRecordExpensePayment({ ...approvedByPastor, actorUid: "staff-1" }),
    false,
  );
});

test("confirmed appointment collision check treats touching times as non-overlapping", () => {
  const hour = 60 * 60 * 1000;
  assert.equal(appointmentTimesOverlap(10 * hour, 60, 10.5 * hour, 45), true);
  assert.equal(appointmentTimesOverlap(10 * hour, 60, 11 * hour, 45), false);
  assert.equal(appointmentTimesOverlap(Number.NaN, 60, 11 * hour, 45), false);
});

test("expense status machine blocks reversals and premature payment", async () => {
  const { expenseTransitionAllowed } = await import("./policies");
  assert.equal(expenseTransitionAllowed("submitted", "approved"), true);
  assert.equal(expenseTransitionAllowed("clarification", "approved"), true);
  assert.equal(expenseTransitionAllowed("approved", "paid"), true);
  assert.equal(expenseTransitionAllowed("approved", "rejected"), false);
  assert.equal(expenseTransitionAllowed("approved", "approved"), false);
  assert.equal(expenseTransitionAllowed("submitted", "paid"), false);
  assert.equal(expenseTransitionAllowed("paid", "approved"), false);
  assert.equal(expenseTransitionAllowed("rejected", "approved"), false);
  assert.equal(expenseTransitionAllowed(undefined, "approved"), false);
});

test("only the owner manages other non-owner members", async () => {
  const { canManageMember } = await import("./policies");
  const base = { actorRole: "owner" as const, actorUid: "o", targetUid: "s", targetRole: "staff" };
  assert.equal(canManageMember(base), true);
  assert.equal(canManageMember({ ...base, actorRole: "pastor" }), false);
  assert.equal(canManageMember({ ...base, targetUid: "o" }), false);
  assert.equal(canManageMember({ ...base, targetRole: "owner" }), false);
});

test("slugs are URL-safe and never empty", async () => {
  const { slugify, normalizeEmail } = await import("./policies");
  assert.equal(slugify("Église Saint-Pierre & Paul!"), "eglise-saint-pierre-paul");
  assert.equal(slugify("***"), "church");
  assert.equal(normalizeEmail("  Pastor@Example.COM "), "pastor@example.com");
});
