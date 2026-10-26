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
    actor: { role: "finance" as const, permissions: ["expenses", "payments"] as const },
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
  assert.equal(
    canRecordExpensePayment({ ...approvedByPastor, actor: { role: "staff", permissions: ["expenses"] } }),
    false,
    "recording payments needs the payments access",
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

test("pastors and team managers manage the team; only pastors control pastor access", async () => {
  const { canManageMember, canInviteRole, permissionsFor } = await import("./policies");
  const admin = { role: "admin" as const, permissions: permissionsFor("admin", undefined) };
  const pastor = { role: "pastor" as const, permissions: permissionsFor("pastor", undefined) };
  const staff = { role: "staff" as const, permissions: permissionsFor("staff", undefined) };
  const base = { actor: admin, actorUid: "a", targetUid: "s", targetRole: "staff" as const, churchHasPastor: true };
  assert.equal(canManageMember(base), true);
  assert.equal(canManageMember({ ...base, actor: pastor }), true);
  assert.equal(canManageMember({ ...base, actor: staff }), false);
  assert.equal(canManageMember({ ...base, actor: { role: "staff", permissions: ["team"] } }), true, "team access manages the team");
  assert.equal(canManageMember({ ...base, targetUid: "a" }), false, "never yourself");
  assert.equal(canManageMember({ ...base, targetRole: "pastor" }), false, "admin cannot touch a pastor");
  assert.equal(canManageMember({ ...base, actor: pastor, targetRole: "pastor" }), true);
  assert.equal(canManageMember({ ...base, newRole: "pastor" }), false, "admin cannot promote once a pastor exists");
  assert.equal(canManageMember({ ...base, newRole: "pastor", churchHasPastor: false }), true);
  assert.equal(canManageMember({ ...base, newRole: "finance" }), true);
  assert.equal(canInviteRole(admin, "pastor", true), false);
  assert.equal(canInviteRole(admin, "pastor", false), true);
  assert.equal(canInviteRole(pastor, "pastor", true), true);
  assert.equal(canInviteRole(staff, "staff", true), false);
});

test("roles are starting points; pastors always have everything; care access needs a pastor", async () => {
  const { permissionsFor, forbiddenCareGrants, canSeeRequest, PERMISSIONS } = await import("./policies");
  assert.deepEqual(permissionsFor("pastor", ["qr"]), [...PERMISSIONS]);
  assert.deepEqual(permissionsFor("staff", undefined), ["enquiries", "calendar", "qr", "reports", "expenses"]);
  assert.deepEqual(permissionsFor("staff", ["expenses", "nonsense"]), ["expenses"]);
  assert.deepEqual(permissionsFor("prayer_team", undefined), ["prayer"]);
  const admin = { role: "admin" as const, permissions: permissionsFor("admin", undefined) };
  assert.deepEqual(forbiddenCareGrants(admin, true, [], ["prayer", "qr"]), ["prayer"]);
  assert.deepEqual(forbiddenCareGrants(admin, true, ["prayer"], ["prayer"]), [], "keeping existing access is fine");
  assert.deepEqual(forbiddenCareGrants(admin, false, [], ["enquiries"]), [], "before a pastor joins");
  const team = { role: "prayer_team" as const, permissions: permissionsFor("prayer_team", undefined) };
  assert.equal(canSeeRequest(team, { type: "prayer", shareWithPrayerTeam: true }), true);
  assert.equal(canSeeRequest(team, { type: "prayer", shareWithPrayerTeam: false }), false);
  assert.equal(canSeeRequest(team, { type: "counselling", shareWithPrayerTeam: true }), false);
  assert.equal(canSeeRequest(team, { type: "general" }), false);
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
