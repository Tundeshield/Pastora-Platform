import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentTimesOverlap,
  canApproveExpense,
  canRecordExpensePayment,
  canViewPastoralCare,
  sameChurch,
} from "./policies";

test("tenant check denies cross-church identifiers", () => {
  assert.equal(sameChurch("church-a", "church-a"), true);
  assert.equal(sameChurch("church-b", "church-a"), false);
  assert.equal(sameChurch(undefined, "church-a"), false);
});

test("pastoral care is for pastors only, not even the workspace admin", () => {
  assert.equal(canViewPastoralCare("pastor"), true);
  assert.equal(canViewPastoralCare("staff"), false);
  assert.equal(canViewPastoralCare("finance"), false);
  assert.equal(canViewPastoralCare("admin"), false);
});

test("legacy roles map onto the simplified set", async () => {
  const { normalizeRole } = await import("./pastora-data");
  assert.equal(normalizeRole("owner"), "pastor");
  assert.equal(normalizeRole("counsellor"), "pastor");
  assert.equal(normalizeRole("department_leader"), "staff");
  assert.equal(normalizeRole("finance"), "finance");
  assert.equal(normalizeRole("admin"), "admin");
  assert.equal(normalizeRole("superuser"), null);
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

test("pastors and admins manage the team; only pastors control pastor access", async () => {
  const { canManageMember, canInviteRole } = await import("./policies");
  const base = {
    actorRole: "admin" as const,
    actorUid: "a",
    targetUid: "s",
    targetRole: "staff" as const,
    churchHasPastor: true,
  };
  assert.equal(canManageMember(base), true);
  assert.equal(canManageMember({ ...base, actorRole: "pastor" }), true);
  assert.equal(canManageMember({ ...base, actorRole: "staff" }), false);
  assert.equal(canManageMember({ ...base, targetUid: "a" }), false, "never yourself");
  assert.equal(canManageMember({ ...base, targetRole: "pastor" }), false, "admin cannot touch a pastor");
  assert.equal(canManageMember({ ...base, actorRole: "pastor", targetRole: "pastor" }), true);
  assert.equal(canManageMember({ ...base, newRole: "pastor" }), false, "admin cannot promote once a pastor exists");
  assert.equal(canManageMember({ ...base, newRole: "pastor", churchHasPastor: false }), true);
  assert.equal(canManageMember({ ...base, newRole: "finance" }), true);
  assert.equal(canInviteRole("admin", "pastor", true), false);
  assert.equal(canInviteRole("admin", "pastor", false), true);
  assert.equal(canInviteRole("pastor", "pastor", true), true);
  assert.equal(canInviteRole("staff", "staff", true), false);
});

test("platform admins come only from a verified email on the server allow list or a claim", async () => {
  const { isPlatformAdmin } = await import("./policies");
  const list = "Admin@Pastora.test, other@pastora.test";
  assert.equal(isPlatformAdmin({ email: "admin@pastora.test", email_verified: true }, list), true);
  assert.equal(isPlatformAdmin({ email: "admin@pastora.test", email_verified: false }, list), false);
  assert.equal(isPlatformAdmin({ email: "someone@pastora.test", email_verified: true }, list), false);
  assert.equal(isPlatformAdmin({ email: "admin@pastora.test", email_verified: true }, undefined), false);
  assert.equal(isPlatformAdmin({ email: "x@y.test", email_verified: true, platformAdmin: true }, ""), true);
  assert.equal(isPlatformAdmin(null, list), false);
});

test("slugs are URL-safe and never empty", async () => {
  const { slugify, normalizeEmail } = await import("./policies");
  assert.equal(slugify("Église Saint-Pierre & Paul!"), "eglise-saint-pierre-paul");
  assert.equal(slugify("***"), "church");
  assert.equal(normalizeEmail("  Pastor@Example.COM "), "pastor@example.com");
});
