/**
 * API integration tests: the real Express routes, authorisation logic and Firestore
 * access code, running against an in-memory Firestore and fake token verification.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "test";
process.env.PUBLIC_SUBMISSIONS_PER_MINUTE = "10000";

const { FakeAuth, FakeFirestore } = await import("./fake-firebase");
const { setFirebaseServicesForTesting } = await import("../lib/firebase-admin");
const { default: app } = await import("../app");

let server: Server;
let baseUrl = "";
let db: InstanceType<typeof FakeFirestore>;
let auth: InstanceType<typeof FakeAuth>;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

beforeEach(() => {
  db = new FakeFirestore();
  auth = new FakeAuth();
  setFirebaseServicesForTesting({ app: {} as never, auth: auth as never, db: db as never });
});

type Json = Record<string, any>;
async function call(method: string, path: string, token?: string | null, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
}

let userCounter = 0;
function user(opts: { verified?: boolean; email?: string; name?: string } = {}) {
  userCounter += 1;
  const uid = `user${userCounter}`;
  const email = opts.email ?? `${uid}@example.test`;
  return { uid, email, token: auth.add({ uid, email, emailVerified: opts.verified ?? true, name: opts.name }) };
}

const workspace = (churchName = "Grace Chapel") => ({
  pastorName: "Pastor Ade",
  churchName,
  country: "Nigeria",
  timeZone: "Africa/Lagos",
  theme: "modern-cool",
});

async function ownerWithChurch(churchName = "Grace Chapel") {
  const owner = user();
  const created = await call("POST", "/onboarding", owner.token, workspace(churchName));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { ...owner, church: created.body.church as Json };
}

/** Invite + verified sign-in, returning a member with the given role. */
async function member(ownerToken: string, role: string, department?: string) {
  const person = user();
  const invite = await call("POST", "/team/invitations", ownerToken, {
    email: person.email,
    role,
    department: department ?? null,
  });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const session = await call("GET", "/session", person.token);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, role);
  return person;
}

async function publicRequest(slug: string, body: Json) {
  return call("POST", `/public/churches/${slug}/requests`, null, {
    anonymous: false,
    permissionToContact: true,
    shareWithPrayerTeam: false,
    ...body,
  });
}

describe("authentication and onboarding", () => {
  test("rejects missing and invalid tokens", async () => {
    assert.equal((await call("GET", "/session")).status, 401);
    assert.equal((await call("GET", "/session", "token:nobody")).status, 401);
    assert.equal((await call("GET", "/dashboard", "garbage")).status, 401);
  });

  test("an unverified account cannot create a workspace", async () => {
    const pastor = user({ verified: false });
    const session = await call("GET", "/session", pastor.token);
    assert.equal(session.body.emailVerified, false);
    assert.equal(session.body.church, null);
    const created = await call("POST", "/onboarding", pastor.token, workspace());
    assert.equal(created.status, 403);
    assert.equal(db.all("churches").length, 0);
  });

  test("a verified pastor creates a workspace and becomes its owner", async () => {
    const pastor = user({ email: "Pastor@Example.test" });
    const created = await call("POST", "/onboarding", pastor.token, {
      ...workspace(),
      role: "finance", // attempted privilege injection — must be ignored
      churchId: "someone-elses-church",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, "owner");
    assert.equal(created.body.church.slug, "grace-chapel");
    assert.equal(created.body.theme, "modern-cool");

    const memberships = db.all("churchMemberships");
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].role, "owner");
    assert.equal(memberships[0].churchId, created.body.church.id);
    assert.equal(db.all("churchSettings").length, 1);
    assert.equal(db.all("subscriptions")[0].status, "setup_required");
    assert.equal(db.all("users")[0].primaryChurchId, created.body.church.id);

    // Signing back in restores the same workspace.
    const session = await call("GET", "/session", pastor.token);
    assert.equal(session.body.church.id, created.body.church.id);
    assert.equal(session.body.user.name, "Pastor Ade");
    assert.equal((await call("GET", "/dashboard", pastor.token)).status, 200);
  });

  test("onboarding is idempotent, including concurrent double submits", async () => {
    const pastor = user();
    const [a, b] = await Promise.all([
      call("POST", "/onboarding", pastor.token, workspace()),
      call("POST", "/onboarding", pastor.token, workspace()),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    assert.equal(a.body.church.id, b.body.church.id);
    const retry = await call("POST", "/onboarding", pastor.token, workspace("Different Name"));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.church.id, a.body.church.id);
    assert.equal(db.all("churches").length, 1);
    assert.equal(db.all("churchMemberships").length, 1);
  });

  test("a request that loses the onboarding race returns the winner's workspace", async () => {
    const pastor = user();
    const first = await call("POST", "/onboarding", pastor.token, workspace());
    // Simulate a racing request that saw no workspace yet: hide the profile pointer and
    // the membership so only the atomic membership lock can stop a duplicate.
    const membershipPath = `churchMemberships/${first.body.church.id}_${pastor.uid}`;
    const membership = db.store.get(membershipPath)!;
    db.store.set(`users/${pastor.uid}`, { uid: pastor.uid });
    db.store.delete(membershipPath);
    const second = await call("POST", "/onboarding", pastor.token, workspace());
    assert.equal(second.status, 200);
    assert.equal(db.all("churches").length, 1);
    assert.equal(db.all("churchSlugs").length, 1);
    db.store.set(membershipPath, membership);
    assert.equal((await call("GET", "/session", pastor.token)).body.church.id, first.body.church.id);
  });

  test("churches with the same name get unique public addresses", async () => {
    const one = await ownerWithChurch("Grace Chapel");
    const two = await ownerWithChurch("Grace Chapel");
    assert.equal(one.church.slug, "grace-chapel");
    assert.equal(two.church.slug, "grace-chapel-2");
  });

  test("invalid onboarding input returns an understandable error", async () => {
    const pastor = user();
    const response = await call("POST", "/onboarding", pastor.token, { churchName: "" });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /required/i);
  });

  test("a team member cannot create a second workspace", async () => {
    const owner = await ownerWithChurch();
    const staff = await member(owner.token, "staff");
    const response = await call("POST", "/onboarding", staff.token, workspace("Side Church"));
    assert.equal(response.status, 409);
  });
});

describe("team management and roles", () => {
  test("invitations are only accepted after the invitee verifies their email", async () => {
    const owner = await ownerWithChurch();
    const invitee = user({ verified: false });
    assert.equal(
      (await call("POST", "/team/invitations", owner.token, { email: invitee.email, role: "counsellor" })).status,
      201,
    );
    const pending = await call("GET", "/session", invitee.token);
    assert.equal(pending.body.church, null);
    assert.equal(pending.body.invitationPending, true);
    assert.equal(db.all("churchMemberships").length, 1);

    auth.users.get(invitee.uid)!.emailVerified = true;
    const accepted = await call("GET", "/session", invitee.token);
    assert.equal(accepted.body.church.id, owner.church.id);
    assert.equal(accepted.body.user.role, "counsellor");
  });

  test("only the owner can invite or change roles, and nobody can change their own role", async () => {
    const owner = await ownerWithChurch();
    const pastor = await member(owner.token, "pastor");
    const staff = await member(owner.token, "staff");

    assert.equal(
      (await call("POST", "/team/invitations", pastor.token, { email: "x@example.test", role: "finance" })).status,
      403,
    );
    const team = await call("GET", "/team", owner.token);
    assert.equal(team.status, 200);
    const ownerMembership = team.body.members.find((m: Json) => m.role === "owner");
    const staffMembership = team.body.members.find((m: Json) => m.uid === staff.uid);

    assert.equal((await call("PATCH", `/team/members/${staffMembership.id}`, staff.token, { role: "pastor" })).status, 403);
    assert.equal((await call("PATCH", `/team/members/${ownerMembership.id}`, owner.token, { role: "staff" })).status, 403);
    assert.equal((await call("PATCH", `/team/members/${staffMembership.id}`, pastor.token, { role: "finance" })).status, 403);
    // The owner role can never be granted through the API.
    assert.equal((await call("PATCH", `/team/members/${staffMembership.id}`, owner.token, { role: "owner" })).status, 400);

    const promoted = await call("PATCH", `/team/members/${staffMembership.id}`, owner.token, { role: "counsellor" });
    assert.equal(promoted.status, 200);
    assert.equal((await call("GET", "/session", staff.token)).body.user.role, "counsellor");
    assert.ok(db.all("auditLogs").some((log) => log.action === "member_updated" && log.toRole === "counsellor"));

    // Deactivating a member removes their workspace access and frees their account.
    await call("PATCH", `/team/members/${staffMembership.id}`, owner.token, { active: false });
    assert.equal((await call("GET", "/requests", staff.token)).status, 409);
    assert.equal(db.store.has(`membershipLocks/${staff.uid}`), false);
    const restored = await call("PATCH", `/team/members/${staffMembership.id}`, owner.token, { active: true });
    assert.equal(restored.status, 200);
    assert.equal((await call("GET", "/requests", staff.token)).status, 200);
  });

  test("an owner cannot manage another church's members", async () => {
    const a = await ownerWithChurch("Church A");
    const b = await ownerWithChurch("Church B");
    const staffA = await member(a.token, "staff");
    const membershipId = `${a.church.id}_${staffA.uid}`;
    assert.equal((await call("PATCH", `/team/members/${membershipId}`, b.token, { role: "pastor" })).status, 404);
  });
});

describe("tenant isolation", () => {
  test("church B cannot read or modify church A's records", async () => {
    const a = await ownerWithChurch("Church A");
    const b = await ownerWithChurch("Church B");

    const req = await call("POST", "/requests", a.token, { type: "prayer", message: "Pray for my family" });
    const appt = await call("POST", "/appointments", a.token, {
      requesterName: "Ola",
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      durationMinutes: 30,
      format: "phone",
      status: "requested",
    });
    const task = await call("POST", "/tasks", a.token, { title: "Visit", priority: "normal" });
    const qr = await call("POST", "/qr-codes", a.token, { name: "Lobby", destination: "prayer" });
    const report = await call("POST", "/reports", a.token, {
      department: "Choir",
      period: "May",
      activities: "Practice",
      challenges: null,
      supportNeeded: null,
      nextPlans: "Concert",
    });
    for (const created of [req, appt, task, qr, report]) assert.equal(created.status, 201, JSON.stringify(created.body));

    for (const path of ["/requests", "/appointments", "/tasks", "/qr-codes", "/reports", "/expenses"]) {
      const list = await call("GET", path, b.token);
      assert.equal(list.status, 200, path);
      assert.equal(list.body.length, 0, `${path} leaked records across churches`);
    }
    assert.equal((await call("PATCH", `/requests/${req.body.id}`, b.token, { status: "closed" })).status, 404);
    assert.equal((await call("POST", `/requests/${req.body.id}/notes`, b.token, { note: "x" })).status, 404);
    assert.equal((await call("PATCH", `/appointments/${appt.body.id}`, b.token, { status: "cancelled" })).status, 404);
    assert.equal((await call("PATCH", `/tasks/${task.body.id}`, b.token, { status: "completed" })).status, 404);
    assert.equal((await call("PATCH", `/qr-codes/${qr.body.id}`, b.token, { active: false })).status, 404);
    assert.equal((await call("PATCH", `/reports/${report.body.id}`, b.token, { status: "reviewed" })).status, 404);

    // Church A's data is unchanged.
    assert.equal(db.store.get(`pastoralRequests/${req.body.id}`)?.status, "new");
    assert.equal(db.store.get(`qrCodes/${qr.body.id}`)?.active, true);
  });

  test("church B cannot touch church A's expenses", async () => {
    const a = await ownerWithChurch("Church A");
    const b = await ownerWithChurch("Church B");
    const leader = await member(a.token, "department_leader", "Youth");
    const expense = await call("POST", "/expenses", leader.token, { description: "Chairs", purpose: "Hall", amount: 5000 });
    assert.equal((await call("PATCH", `/expenses/${expense.body.id}`, b.token, { status: "approved" })).status, 404);
  });

  test("notifications are private to the recipient", async () => {
    const a = await ownerWithChurch("Church A");
    const b = await ownerWithChurch("Church B");
    await publicRequest(a.church.slug, { type: "prayer", message: "Help" });
    const notices = await call("GET", "/notifications", a.token);
    assert.equal(notices.body.length, 1);
    assert.equal((await call("POST", `/notifications/${notices.body[0].id}/read`, b.token)).status, 404);
    assert.equal((await call("GET", "/notifications", b.token)).body.length, 0);
  });
});

describe("pastoral care", () => {
  test("public prayer and counselling submissions are stored, with counselling details kept separate", async () => {
    const owner = await ownerWithChurch();
    const prayer = await publicRequest(owner.church.slug, { type: "prayer", message: "Healing", anonymous: true, name: "Hidden" });
    assert.equal(prayer.status, 201);
    const counselling = await publicRequest(owner.church.slug, {
      type: "counselling",
      name: "Bisi",
      contact: "0800",
      message: "Marriage struggles",
    });
    assert.equal(counselling.status, 201);

    const requestDoc = db.store.get(`pastoralRequests/${db.all("counsellingCases")[0].id}`);
    assert.equal(requestDoc?.message, "", "counselling message must not sit in the shared collection");
    assert.equal(requestDoc?.name, null);
    assert.equal(db.all("counsellingCases")[0].message, "Marriage struggles");
    const anonymous = db.all("pastoralRequests").find((r) => r.type === "prayer");
    assert.equal(anonymous?.name, null, "anonymous requests must not store a name");

    const inbox = await call("GET", "/requests", owner.token);
    const visible = inbox.body.find((r: Json) => r.type === "counselling");
    assert.equal(visible.message, "Marriage struggles");
  });

  test("counselling requires consent to contact", async () => {
    const owner = await ownerWithChurch();
    const response = await publicRequest(owner.church.slug, {
      type: "counselling",
      message: "Help",
      permissionToContact: false,
    });
    assert.equal(response.status, 400);
  });

  test("staff and finance cannot see prayer or counselling requests; counsellors can", async () => {
    const owner = await ownerWithChurch();
    await publicRequest(owner.church.slug, { type: "prayer", message: "Prayer" });
    await publicRequest(owner.church.slug, { type: "counselling", message: "Confidential" });
    await publicRequest(owner.church.slug, { type: "general", message: "Office hours?" });
    const staff = await member(owner.token, "staff");
    const finance = await member(owner.token, "finance");
    const counsellor = await member(owner.token, "counsellor");

    const staffView = await call("GET", "/requests", staff.token);
    assert.deepEqual(staffView.body.map((r: Json) => r.type), ["general"]);
    assert.ok(!JSON.stringify(staffView.body).includes("Confidential"));
    const financeView = await call("GET", "/requests", finance.token);
    assert.deepEqual(financeView.body.map((r: Json) => r.type), ["general"]);

    const counsellorView = await call("GET", "/requests", counsellor.token);
    assert.ok(counsellorView.body.some((r: Json) => r.message === "Confidential"));

    const counsellingId = db.all("counsellingCases")[0].id;
    assert.equal((await call("PATCH", `/requests/${counsellingId}`, staff.token, { status: "closed" })).status, 403);
    assert.equal((await call("POST", `/requests/${counsellingId}/notes`, staff.token, { note: "peek" })).status, 403);
  });

  test("private notes are restricted and audited", async () => {
    const owner = await ownerWithChurch();
    const created = await call("POST", "/requests", owner.token, { type: "prayer", message: "Pray" });
    const note = await call("POST", `/requests/${created.body.id}/notes`, owner.token, { note: "Called on Tuesday" });
    assert.equal(note.status, 201);
    assert.equal(db.all("pastoralNotes")[0].restricted, true);
    assert.ok(db.all("auditLogs").some((log) => log.action === "restricted_pastoral_note_created"));
  });

  test("public forms reject unknown churches and disabled portals", async () => {
    const owner = await ownerWithChurch();
    assert.equal((await publicRequest("no-such-church", { type: "prayer", message: "x" })).status, 404);
    await call("PATCH", "/settings", owner.token, { publicPortalEnabled: false });
    assert.equal((await publicRequest(owner.church.slug, { type: "prayer", message: "x" })).status, 404);
    assert.equal((await call("GET", `/public/churches/${owner.church.slug}`)).status, 404);
  });
});

describe("appointments", () => {
  test("public appointment requests need a future date", async () => {
    const owner = await ownerWithChurch();
    assert.equal((await publicRequest(owner.church.slug, { type: "appointment", message: "Chat" })).status, 400);
    const past = await publicRequest(owner.church.slug, {
      type: "appointment",
      message: "Chat",
      preferredDate: new Date(Date.now() - 3_600_000).toISOString(),
    });
    assert.equal(past.status, 400);
    const ok = await publicRequest(owner.church.slug, {
      type: "appointment",
      message: "Chat",
      preferredDate: new Date(Date.now() + 86_400_000).toISOString(),
      preferredFormat: "video",
    });
    assert.equal(ok.status, 201);
    const list = await call("GET", "/appointments", owner.token);
    assert.equal(list.body[0].status, "requested");
  });

  test("confirmed appointments cannot overlap", async () => {
    const owner = await ownerWithChurch();
    const start = new Date(Date.now() + 2 * 86_400_000);
    const base = { requesterName: "A", durationMinutes: 60, format: "in-person" };
    const first = await call("POST", "/appointments", owner.token, { ...base, startAt: start.toISOString(), status: "confirmed" });
    assert.equal(first.status, 201);
    const clash = await call("POST", "/appointments", owner.token, {
      ...base,
      startAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      status: "confirmed",
    });
    assert.equal(clash.status, 409);
    const requested = await call("POST", "/appointments", owner.token, {
      ...base,
      startAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
      status: "requested",
    });
    assert.equal(requested.status, 201);
    assert.equal((await call("PATCH", `/appointments/${requested.body.id}`, owner.token, { status: "confirmed" })).status, 409);
    const moved = await call("PATCH", `/appointments/${requested.body.id}`, owner.token, {
      status: "confirmed",
      startAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
    });
    assert.equal(moved.status, 200, "back-to-back appointments are allowed");
  });
});

describe("expenses", () => {
  test("full approval and payment workflow with separation of duties", async () => {
    const owner = await ownerWithChurch();
    const pastor = await member(owner.token, "pastor");
    const leader = await member(owner.token, "department_leader", "Youth");
    const finance = await member(owner.token, "finance");

    const created = await call("POST", "/expenses", leader.token, {
      description: "Projector",
      purpose: "Youth service",
      amount: 120000,
      department: "Youth",
    });
    assert.equal(created.status, 201);
    const id = created.body.id;

    assert.equal((await call("GET", "/expenses", leader.token)).body.length, 1, "requester sees own expense");
    assert.equal((await call("PATCH", `/expenses/${id}`, leader.token, { status: "approved" })).status, 403);
    assert.equal((await call("PATCH", `/expenses/${id}`, finance.token, { status: "approved" })).status, 403);
    assert.equal(
      (await call("PATCH", `/expenses/${id}`, finance.token, { status: "paid", paymentReference: "TRX1" })).status,
      409,
      "cannot pay before approval",
    );

    const approved = await call("PATCH", `/expenses/${id}`, pastor.token, { status: "approved" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.approvedBy, pastor.uid);

    assert.equal((await call("PATCH", `/expenses/${id}`, owner.token, { status: "rejected" })).status, 409, "approved cannot be reversed");
    assert.equal((await call("PATCH", `/expenses/${id}`, owner.token, { status: "approved" })).status, 409);
    assert.equal(
      (await call("PATCH", `/expenses/${id}`, owner.token, { status: "paid", paymentReference: "TRX1" })).status,
      403,
      "only finance records payments",
    );
    assert.equal((await call("PATCH", `/expenses/${id}`, finance.token, { status: "paid" })).status, 400);

    const paid = await call("PATCH", `/expenses/${id}`, finance.token, { status: "paid", paymentReference: "TRX-889" });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.paymentReference, "TRX-889");
    assert.equal((await call("PATCH", `/expenses/${id}`, finance.token, { status: "paid", paymentReference: "X" })).status, 409);

    const trail = db.all("auditLogs").filter((log) => log.recordId === id);
    assert.deepEqual(
      trail.map((log) => [log.fromStatus, log.toStatus]),
      [
        ["submitted", "approved"],
        ["approved", "paid"],
      ],
    );
  });

  test("a pastor cannot approve their own expense and clarification needs a reason", async () => {
    const owner = await ownerWithChurch();
    const pastor = await member(owner.token, "pastor");
    const own = await call("POST", "/expenses", pastor.token, { description: "Fuel", purpose: "Visit", amount: 100 });
    assert.equal((await call("PATCH", `/expenses/${own.body.id}`, pastor.token, { status: "approved" })).status, 403);
    assert.equal((await call("PATCH", `/expenses/${own.body.id}`, owner.token, { status: "clarification" })).status, 400);
    const clarified = await call("PATCH", `/expenses/${own.body.id}`, owner.token, {
      status: "clarification",
      clarification: "Attach the receipt",
    });
    assert.equal(clarified.status, 200);
    assert.equal(clarified.body.clarification, "Attach the receipt");
  });

  test("counsellors cannot see or submit expenses", async () => {
    const owner = await ownerWithChurch();
    const counsellor = await member(owner.token, "counsellor");
    assert.equal((await call("GET", "/expenses", counsellor.token)).status, 403);
    assert.equal(
      (await call("POST", "/expenses", counsellor.token, { description: "x", purpose: "y", amount: 1 })).status,
      403,
    );
  });
});

describe("tasks, reports and QR links", () => {
  test("assignees can update status only", async () => {
    const owner = await ownerWithChurch();
    const staff = await member(owner.token, "staff");
    const task = await call("POST", "/tasks", owner.token, { title: "Call Mrs Ola", priority: "high", assignedTo: staff.uid });
    assert.equal(task.status, 201);
    assert.equal((await call("GET", "/tasks", staff.token)).body.length, 1);
    assert.equal((await call("PATCH", `/tasks/${task.body.id}`, staff.token, { title: "Changed" })).status, 403);
    const done = await call("PATCH", `/tasks/${task.body.id}`, staff.token, { status: "completed" });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, "completed");
    assert.equal(
      (await call("POST", "/tasks", owner.token, { title: "x", priority: "low", assignedTo: "not-a-member" })).status,
      400,
    );
  });

  test("department reports are submitted and reviewed by a pastor", async () => {
    const owner = await ownerWithChurch();
    const leader = await member(owner.token, "department_leader", "Choir");
    const report = await call("POST", "/reports", leader.token, {
      department: "Choir",
      period: "June",
      activities: "Rehearsals",
      challenges: null,
      supportNeeded: "Microphones",
      nextPlans: "Easter",
    });
    assert.equal(report.status, 201);
    assert.equal((await call("PATCH", `/reports/${report.body.id}`, leader.token, { status: "reviewed" })).status, 403);
    const reviewed = await call("PATCH", `/reports/${report.body.id}`, owner.token, {
      status: "needs_follow_up",
      reviewComment: "Share the budget",
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.reviewComment, "Share the budget");
  });

  test("QR visits and submissions are counted only for the owning church's active links", async () => {
    const a = await ownerWithChurch("Church A");
    const b = await ownerWithChurch("Church B");
    const qr = await call("POST", "/qr-codes", a.token, { name: "Lobby", destination: "prayer", campaign: "Sunday" });
    assert.equal((await call("POST", `/public/qr-codes/${qr.body.id}/visit`)).status, 204);
    assert.equal((await call("POST", `/public/qr-codes/does-not-exist/visit`)).status, 204);

    await publicRequest(a.church.slug, { type: "prayer", message: "via QR", qrCodeId: qr.body.id });
    await publicRequest(b.church.slug, { type: "prayer", message: "wrong church", qrCodeId: qr.body.id });

    let stored = db.store.get(`qrCodes/${qr.body.id}`)!;
    assert.equal(stored.visits, 1);
    assert.equal(stored.submissions, 1);

    await call("PATCH", `/qr-codes/${qr.body.id}`, a.token, { active: false });
    await call("POST", `/public/qr-codes/${qr.body.id}/visit`);
    stored = db.store.get(`qrCodes/${qr.body.id}`)!;
    assert.equal(stored.visits, 1, "paused links are not counted");
  });
});

describe("settings and session", () => {
  test("theme preference is stored on the workspace and returned in the session", async () => {
    const owner = await ownerWithChurch();
    const staff = await member(owner.token, "staff");
    assert.equal((await call("PATCH", "/settings", staff.token, { theme: "warm-cream" })).status, 403);
    assert.equal((await call("PATCH", "/settings", owner.token, { theme: "warm-cream" })).status, 200);
    assert.equal((await call("GET", "/session", staff.token)).body.theme, "warm-cream");
  });

  test("new workspaces default to Inter and normal text; appearance fields update independently", async () => {
    const owner = await ownerWithChurch();
    const staff = await member(owner.token, "staff");
    const initial = await call("GET", "/session", staff.token);
    assert.equal(initial.body.theme, "modern-cool"); // chosen during onboarding
    assert.equal(initial.body.fontFamily, "inter");
    assert.equal(initial.body.fontSize, "normal");

    assert.equal((await call("PATCH", "/settings", owner.token, { theme: "forest-dark" })).status, 200);
    assert.equal((await call("PATCH", "/settings", owner.token, { fontFamily: "lora" })).status, 200);
    const sized = await call("PATCH", "/settings", owner.token, { fontSize: "large" });
    assert.equal(sized.status, 200);
    assert.deepEqual([sized.body.theme, sized.body.fontFamily, sized.body.fontSize], ["forest-dark", "lora", "large"]);

    // Every member of the workspace gets the same appearance on any device.
    const forStaff = await call("GET", "/session", staff.token);
    assert.deepEqual([forStaff.body.theme, forStaff.body.fontFamily, forStaff.body.fontSize], ["forest-dark", "lora", "large"]);

    assert.equal((await call("PATCH", "/settings", owner.token, { fontFamily: "comic-sans" })).status, 400);
    assert.equal((await call("PATCH", "/settings", staff.token, { fontSize: "small" })).status, 403);
    for (const theme of ["warm-cream", "modern-cool", "sage", "heritage-blue", "forest-dark"]) {
      assert.equal((await call("PATCH", "/settings", owner.token, { theme })).body.theme, theme);
    }
  });

  test("existing workspaces keep their palette and get typography defaults", async () => {
    const owner = await ownerWithChurch();
    // Simulate a workspace created before typography settings existed.
    const settingsPath = `churchSettings/${owner.church.id}`;
    const legacy = { ...db.store.get(settingsPath)! };
    delete legacy.fontFamily;
    delete legacy.fontSize;
    db.store.set(settingsPath, legacy);
    const session = await call("GET", "/session", owner.token);
    assert.deepEqual([session.body.theme, session.body.fontFamily, session.body.fontSize], ["modern-cool", "inter", "normal"]);
    const settings = await call("GET", "/settings", owner.token);
    assert.equal(settings.body.fontFamily, "inter");
  });

  test("platform workspace list requires the platform-owner claim", async () => {
    const owner = await ownerWithChurch();
    assert.equal((await call("GET", "/platform/workspaces", owner.token)).status, 403);
  });
});
