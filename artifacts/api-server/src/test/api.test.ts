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

/** A pastor who creates a church (the default way a workspace starts). */
async function ownerWithChurch(churchName = "Grace Chapel") {
  const owner = user();
  const created = await call("POST", "/onboarding", owner.token, workspace(churchName));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { ...owner, church: created.body.church as Json };
}

/** Someone who sets a church up on their pastor's behalf. */
async function adminWithChurch(churchName = "Grace Chapel") {
  const admin = user();
  const created = await call("POST", "/onboarding", admin.token, { ...workspace(churchName), creatorRole: "admin" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.user.role, "admin");
  return { ...admin, church: created.body.church as Json };
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

  test("a verified pastor creates a workspace and becomes its pastor", async () => {
    const pastor = user({ email: "Pastor@Example.test" });
    const created = await call("POST", "/onboarding", pastor.token, {
      ...workspace(),
      role: "finance", // attempted privilege injection — must be ignored
      churchId: "someone-elses-church",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, "pastor");
    assert.equal(created.body.church.slug, "grace-chapel");
    assert.equal(created.body.theme, "modern-cool");

    const memberships = db.all("churchMemberships");
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].role, "pastor");
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

  test("a church can't take an address Pastora uses for its own hosts", async () => {
    const church = await ownerWithChurch("App");
    assert.equal(church.church.slug, "app-2");
    const www = await ownerWithChurch("WWW");
    assert.equal(www.church.slug, "www-2");
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
      (await call("POST", "/team/invitations", owner.token, { email: invitee.email, role: "staff" })).status,
      201,
    );
    const pending = await call("GET", "/session", invitee.token);
    assert.equal(pending.body.church, null);
    assert.equal(pending.body.invitationPending, true);
    assert.equal(db.all("churchMemberships").length, 1);

    auth.users.get(invitee.uid)!.emailVerified = true;
    const accepted = await call("GET", "/session", invitee.token);
    assert.equal(accepted.body.church.id, owner.church.id);
    assert.equal(accepted.body.user.role, "staff");
  });

  test("pastors and admins manage the team; nobody changes their own access", async () => {
    const pastor = await ownerWithChurch();
    const admin = await member(pastor.token, "admin");
    const staff = await member(pastor.token, "staff");

    // Staff cannot see or change the team.
    assert.equal((await call("GET", "/team", staff.token)).status, 403);
    assert.equal(
      (await call("POST", "/team/invitations", staff.token, { email: "x@example.test", role: "finance" })).status,
      403,
    );
    // The admin can invite people and change non-pastor roles.
    assert.equal(
      (await call("POST", "/team/invitations", admin.token, { email: "f@example.test", role: "finance" })).status,
      201,
    );
    const team = await call("GET", "/team", admin.token);
    assert.equal(team.status, 200);
    const membershipOf = (uid: string) => team.body.members.find((m: Json) => m.uid === uid).id;

    assert.equal((await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, staff.token, { role: "pastor" })).status, 403);
    assert.equal((await call("PATCH", `/team/members/${membershipOf(admin.uid)}`, admin.token, { role: "staff" })).status, 403);
    assert.equal((await call("PATCH", `/team/members/${membershipOf(pastor.uid)}`, pastor.token, { active: false })).status, 403);
    // Legacy roles can no longer be granted.
    assert.equal((await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, pastor.token, { role: "owner" })).status, 400);
    assert.equal((await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, pastor.token, { role: "counsellor" })).status, 400);

    const changed = await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, admin.token, { role: "finance" });
    assert.equal(changed.status, 200);
    assert.equal((await call("GET", "/session", staff.token)).body.user.role, "finance");
    assert.ok(db.all("auditLogs").some((log) => log.action === "member_updated" && log.toRole === "finance"));
    assert.ok(
      db.all("notifications").some((n) => n.uid === pastor.uid && n.type === "team" && /now Finance/.test(String(n.title))),
      "pastors hear about every role change",
    );

    // Deactivating a member removes their workspace access and frees their account.
    await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, admin.token, { active: false });
    assert.equal((await call("GET", "/expenses", staff.token)).status, 409);
    assert.equal(db.store.has(`membershipLocks/${staff.uid}`), false);
    const restored = await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, admin.token, { active: true });
    assert.equal(restored.status, 200);
    assert.equal((await call("GET", "/expenses", staff.token)).status, 200);
  });

  test("an admin cannot touch a pastor or make anyone a pastor once the church has one", async () => {
    const pastor = await ownerWithChurch();
    const admin = await member(pastor.token, "admin");
    const staff = await member(pastor.token, "staff");
    const team = (await call("GET", "/team", admin.token)).body;
    const membershipOf = (uid: string) => team.members.find((m: Json) => m.uid === uid).id;

    assert.equal(
      (await call("POST", "/team/invitations", admin.token, { email: "alt@example.test", role: "pastor" })).status,
      403,
    );
    assert.equal((await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, admin.token, { role: "pastor" })).status, 403);
    assert.equal((await call("PATCH", `/team/members/${membershipOf(pastor.uid)}`, admin.token, { active: false })).status, 403);
    assert.equal((await call("PATCH", `/team/members/${membershipOf(pastor.uid)}`, admin.token, { role: "staff" })).status, 403);

    // A pastor can add another pastor.
    assert.equal((await call("PATCH", `/team/members/${membershipOf(staff.uid)}`, pastor.token, { role: "pastor" })).status, 200);
    assert.equal((await call("GET", "/session", staff.token)).body.user.role, "pastor");
  });

  test("someone setting up for their pastor never sees pastoral care, and can invite the first pastor", async () => {
    const admin = await adminWithChurch();
    await publicRequest(admin.church.slug, { type: "prayer", message: "Private prayer" });
    await publicRequest(admin.church.slug, { type: "counselling", message: "Confidential" });
    await publicRequest(admin.church.slug, {
      type: "appointment",
      message: "Chat",
      preferredDate: new Date(Date.now() + 86_400_000).toISOString(),
    });

    for (const path of ["/requests", "/appointments", "/reports", "/expenses", "/dashboard"]) {
      assert.equal((await call("GET", path, admin.token)).status, 403, `${path} must be closed to admins`);
    }
    assert.equal((await call("GET", "/notifications", admin.token)).body.length, 0, "no care notifications");
    assert.equal((await call("GET", "/team", admin.token)).status, 200);
    assert.equal((await call("GET", "/settings", admin.token)).status, 200);
    assert.equal((await call("POST", "/qr-codes", admin.token, { name: "Lobby", destination: "prayer" })).status, 201);

    // With no pastor yet, the admin invites one; after that, only pastors add pastors.
    const pastor = await member(admin.token, "pastor");
    assert.equal(
      (await call("POST", "/team/invitations", admin.token, { email: "second@example.test", role: "pastor" })).status,
      403,
    );
    const inbox = await call("GET", "/requests", pastor.token);
    assert.equal(inbox.body.length, 2);
  });

  test("members stored with earlier roles keep working under the simplified roles", async () => {
    const pastor = await ownerWithChurch();
    const staff = await member(pastor.token, "staff");
    const path = `churchMemberships/${pastor.church.id}_${staff.uid}`;
    db.store.set(path, { ...db.store.get(path)!, role: "department_leader" });
    assert.equal((await call("GET", "/session", staff.token)).body.user.role, "staff");
    db.store.set(path, { ...db.store.get(path)!, role: "counsellor" });
    assert.equal((await call("GET", "/session", staff.token)).body.user.role, "pastor");
    const ownerPath = `churchMemberships/${pastor.church.id}_${pastor.uid}`;
    db.store.set(ownerPath, { ...db.store.get(ownerPath)!, role: "owner" });
    assert.equal((await call("GET", "/session", pastor.token)).body.user.role, "pastor");
    assert.equal((await call("GET", "/requests", pastor.token)).status, 200);
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
    const leader = await member(a.token, "staff", "Youth");
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

  test("only pastors see prayer and counselling; staff handle general enquiries", async () => {
    const owner = await ownerWithChurch();
    await publicRequest(owner.church.slug, { type: "prayer", message: "Prayer" });
    await publicRequest(owner.church.slug, { type: "counselling", message: "Confidential" });
    await publicRequest(owner.church.slug, { type: "general", message: "Office hours?" });
    const staff = await member(owner.token, "staff");
    const finance = await member(owner.token, "finance");
    const pastor = await member(owner.token, "pastor");

    const staffView = await call("GET", "/requests", staff.token);
    assert.deepEqual(staffView.body.map((r: Json) => r.type), ["general"]);
    assert.ok(!JSON.stringify(staffView.body).includes("Confidential"));
    assert.equal((await call("GET", "/requests", finance.token)).status, 403);

    const pastorView = await call("GET", "/requests", pastor.token);
    assert.ok(pastorView.body.some((r: Json) => r.message === "Confidential"));

    const counsellingId = db.all("counsellingCases")[0].id;
    assert.equal((await call("PATCH", `/requests/${counsellingId}`, staff.token, { status: "closed" })).status, 404);
    assert.equal((await call("POST", `/requests/${counsellingId}/notes`, staff.token, { note: "peek" })).status, 403);
    const general = staffView.body[0];
    assert.equal((await call("PATCH", `/requests/${general.id}`, staff.token, { status: "acknowledged" })).status, 200);

    // Staff dashboards count general enquiries only.
    const dash = await call("GET", "/dashboard", staff.token);
    assert.equal(dash.body.newPrayerRequests, 0);
    assert.equal(dash.body.counsellingAwaitingReview, 0);
    // Prayer notifications reach pastors only.
    const staffNotices = await call("GET", "/notifications", staff.token);
    assert.ok(staffNotices.body.every((n: Json) => !/pastoral care request|confidential/i.test(n.title)));
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
    const leader = await member(owner.token, "staff", "Youth");
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

  test("the workspace admin cannot see or submit expenses", async () => {
    const owner = await ownerWithChurch();
    const admin = await member(owner.token, "admin");
    assert.equal((await call("GET", "/expenses", admin.token)).status, 403);
    assert.equal(
      (await call("POST", "/expenses", admin.token, { description: "x", purpose: "y", amount: 1 })).status,
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
    const leader = await member(owner.token, "staff", "Choir");
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

});

describe("Pastora admin console", () => {
  function platformAdmin() {
    const person = user({ email: "admin@pastora.test" });
    auth.users.get(person.uid)!.platformAdmin = true;
    return person;
  }

  test("is closed to church members, including pastors and admins", async () => {
    const pastor = await ownerWithChurch();
    const admin = await member(pastor.token, "admin");
    for (const token of [pastor.token, admin.token]) {
      assert.equal((await call("GET", "/platform/workspaces", token)).status, 403);
      assert.equal((await call("GET", "/platform/users", token)).status, 403);
      assert.equal((await call("PATCH", `/platform/workspaces/${pastor.church.id}`, token, { status: "suspended" })).status, 403);
    }
    assert.equal((await call("GET", "/session", pastor.token)).body.platformAdmin, false);
  });

  test("an allow-listed verified email is a platform admin; an unverified one is not", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@pastora.test";
    try {
      const unverified = user({ email: "ops@pastora.test", verified: false });
      assert.equal((await call("GET", "/platform/workspaces", unverified.token)).status, 403);
      auth.users.get(unverified.uid)!.emailVerified = true;
      assert.equal((await call("GET", "/platform/workspaces", unverified.token)).status, 200);
      assert.equal((await call("GET", "/session", unverified.token)).body.platformAdmin, true);
    } finally {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    }
  });

  test("lists churches and accounts without any pastoral content", async () => {
    const pastor = await ownerWithChurch();
    await member(pastor.token, "staff");
    await publicRequest(pastor.church.slug, { type: "prayer", message: "Very private prayer" });
    const ops = platformAdmin();

    const workspaces = await call("GET", "/platform/workspaces", ops.token);
    assert.equal(workspaces.status, 200);
    assert.equal(workspaces.body[0].memberCount, 2);
    assert.equal(workspaces.body[0].status, "active");
    const detail = await call("GET", `/platform/workspaces/${pastor.church.id}`, ops.token);
    assert.equal(detail.body.members.length, 2);
    const users = await call("GET", "/platform/users", ops.token);
    assert.ok(users.body.some((u: Json) => u.uid === pastor.uid && u.churchName === "Grace Chapel" && u.role === "pastor"));
    for (const body of [workspaces.body, detail.body, users.body]) {
      assert.ok(!JSON.stringify(body).includes("Very private prayer"));
    }
  });

  test("suspending a church closes its workspace and care page until reactivated", async () => {
    const pastor = await ownerWithChurch();
    const ops = platformAdmin();
    const paused = await call("PATCH", `/platform/workspaces/${pastor.church.id}`, ops.token, {
      status: "suspended",
      reason: "Unpaid",
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.status, "suspended");

    const session = await call("GET", "/session", pastor.token);
    assert.equal(session.status, 200);
    assert.equal(session.body.churchSuspended, true);
    assert.equal((await call("GET", "/requests", pastor.token)).status, 403);
    assert.equal((await call("GET", `/public/churches/${pastor.church.slug}`)).status, 404);
    assert.equal((await publicRequest(pastor.church.slug, { type: "prayer", message: "x" })).status, 404);

    await call("PATCH", `/platform/workspaces/${pastor.church.id}`, ops.token, { status: "active" });
    assert.equal((await call("GET", "/requests", pastor.token)).status, 200);
    assert.equal((await call("GET", `/public/churches/${pastor.church.slug}`)).status, 200);
    const log = await call("GET", "/platform/audit", ops.token);
    assert.deepEqual(
      log.body.map((entry: Json) => entry.action).sort(),
      ["workspace_reactivated", "workspace_suspended"],
    );
  });

  test("disabling an account ends its access at once; admins can't disable themselves", async () => {
    const pastor = await ownerWithChurch();
    const ops = platformAdmin();
    assert.equal((await call("PATCH", `/platform/users/${ops.uid}`, ops.token, { disabled: true })).status, 400);
    const disabled = await call("PATCH", `/platform/users/${pastor.uid}`, ops.token, { disabled: true });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.disabled, true);
    assert.ok(auth.revoked.has(pastor.uid));
    assert.equal((await call("GET", "/session", pastor.token)).status, 401);
    await call("PATCH", `/platform/users/${pastor.uid}`, ops.token, { disabled: false });
    assert.equal((await call("GET", "/session", pastor.token)).status, 200);
  });

  test("can fix a church's roles when nobody inside can, and tells its pastors", async () => {
    const admin = await adminWithChurch();
    const staff = await member(admin.token, "staff");
    const ops = platformAdmin();
    const fixed = await call("PATCH", `/platform/workspaces/${admin.church.id}/members/${staff.uid}`, ops.token, {
      role: "pastor",
    });
    assert.equal(fixed.status, 200);
    assert.equal((await call("GET", "/session", staff.token)).body.user.role, "pastor");
    assert.ok(db.all("notifications").some((n) => n.uid === admin.uid && /Pastora support/.test(String(n.title))));
    assert.equal(
      (await call("PATCH", `/platform/workspaces/${admin.church.id}/members/nobody`, ops.token, { role: "pastor" })).status,
      404,
    );
  });
});

describe("modules", () => {
  function platformAdmin() {
    const person = user({ email: "ops@pastora.test" });
    auth.users.get(person.uid)!.platformAdmin = true;
    return person;
  }
  const report = {
    department: "Choir",
    period: "June",
    activities: "Rehearsals",
    challenges: null,
    supportNeeded: null,
    nextPlans: "Easter",
  };

  test("during early access, reports and expenses are on by default", async () => {
    const pastor = await ownerWithChurch();
    const session = await call("GET", "/session", pastor.token);
    assert.deepEqual(session.body.modules.sort(), ["blog", "expenses", "message-prep", "reports"]);
    const list = await call("GET", "/modules", pastor.token);
    assert.equal(list.status, 200);
    assert.equal(list.body.earlyAccess, true);
    const sms = list.body.modules.find((m: Json) => m.id === "messaging");
    assert.equal(sms.status, "coming_soon");
    assert.equal(sms.active, false);
  });

  test("pastors and admins switch modules; switched-off modules are closed on the server", async () => {
    const pastor = await ownerWithChurch();
    const admin = await member(pastor.token, "admin");
    const staff = await member(pastor.token, "staff", "Choir");
    assert.equal((await call("GET", "/modules", staff.token)).status, 403);
    assert.equal((await call("PATCH", "/modules/reports", staff.token, { enabled: false })).status, 403);

    const off = await call("PATCH", "/modules/reports", admin.token, { enabled: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.active, false);
    assert.equal((await call("GET", "/reports", staff.token)).status, 403);
    assert.equal((await call("POST", "/reports", staff.token, report)).status, 403);
    assert.deepEqual((await call("GET", "/session", staff.token)).body.modules.sort(), ["blog", "expenses", "message-prep"]);
    assert.ok(db.all("notifications").some((n) => n.uid === pastor.uid && /turned off/.test(String(n.title))));

    await call("PATCH", "/modules/reports", pastor.token, { enabled: true });
    assert.equal((await call("POST", "/reports", staff.token, report)).status, 201);
    // Upcoming modules can't be switched on, but churches can say they'd use them.
    assert.equal((await call("PATCH", "/modules/messaging", pastor.token, { enabled: true })).status, 400);
    const keen = await call("PATCH", "/modules/messaging", pastor.token, { interested: true });
    assert.equal(keen.body.interested, true);
  });

  test("without early access, plans and free grants decide what a church can use", async () => {
    const pastor = await ownerWithChurch();
    const ops = platformAdmin();
    assert.equal((await call("PATCH", "/platform/settings", ops.token, { earlyAccess: false })).status, 200);

    // Starter plan: only Starter modules (the blog); reports and expenses are Church plan.
    assert.deepEqual((await call("GET", "/session", pastor.token)).body.modules, ["blog"]);
    assert.equal((await call("GET", "/reports", pastor.token)).status, 403);
    assert.equal((await call("PATCH", "/modules/reports", pastor.token, { enabled: true })).status, 403);

    // A free grant unlocks one module.
    const granted = await call("PATCH", `/platform/workspaces/${pastor.church.id}/access`, ops.token, {
      grants: ["reports", "not-a-module"],
    });
    assert.equal(granted.status, 200);
    assert.deepEqual(granted.body.grants, ["reports"]);
    assert.equal((await call("GET", "/reports", pastor.token)).status, 200);
    assert.equal((await call("GET", "/expenses", pastor.token)).status, 403);

    // Moving to the Church plan includes expenses too.
    await call("PATCH", `/platform/workspaces/${pastor.church.id}/access`, ops.token, { plan: "church" });
    assert.equal((await call("GET", "/expenses", pastor.token)).status, 200);
  });

  test("Pastora admins add, edit, retire and delete modules, and see demand", async () => {
    const pastor = await ownerWithChurch();
    const ops = platformAdmin();
    assert.equal((await call("GET", "/platform/modules", pastor.token)).status, 403);
    assert.equal(
      (await call("POST", "/platform/modules", pastor.token, { id: "x-mod", name: "X", description: "Nope nope", status: "available", plan: "church" })).status,
      403,
    );

    const created = await call("POST", "/platform/modules", ops.token, {
      id: "hospital-visits",
      name: "Hospital visits",
      description: "Plan and record hospital visits.",
      status: "coming_soon",
      plan: "church",
      roles: ["pastor"],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.builtin, false);
    assert.equal(
      (await call("POST", "/platform/modules", ops.token, { id: "hospital-visits", name: "Again", description: "Duplicate id", status: "beta", plan: "church" })).status,
      409,
    );

    await call("PATCH", "/modules/hospital-visits", pastor.token, { interested: true });
    await call("POST", "/modules/suggestions", pastor.token, { text: "A rota for ushers" });
    const overview = await call("GET", "/platform/modules", ops.token);
    const visits = overview.body.modules.find((m: Json) => m.id === "hospital-visits");
    assert.equal(visits.interestedChurches, 1);
    assert.equal(overview.body.modules.find((m: Json) => m.id === "reports").activeChurches, 1);
    assert.equal(overview.body.suggestions[0].text, "A rota for ushers");
    assert.equal(overview.body.suggestions[0].churchName, "Grace Chapel");

    const edited = await call("PATCH", "/platform/modules/hospital-visits", ops.token, { name: "Hospital & home visits" });
    assert.equal(edited.body.name, "Hospital & home visits");

    // Built-in modules can be retired (hidden and off everywhere) but never deleted.
    assert.equal((await call("DELETE", "/platform/modules/reports", ops.token)).status, 400);
    assert.equal((await call("PATCH", "/platform/modules/reports", ops.token, { status: "coming_soon" })).status, 400);
    await call("PATCH", "/platform/modules/reports", ops.token, { status: "retired" });
    const churchView = await call("GET", "/modules", pastor.token);
    assert.ok(!churchView.body.modules.some((m: Json) => m.id === "reports"));
    assert.equal((await call("GET", "/reports", pastor.token)).status, 403);

    assert.equal((await call("DELETE", "/platform/modules/hospital-visits", ops.token)).status, 204);
    assert.ok(!(await call("GET", "/platform/modules", ops.token)).body.modules.some((m: Json) => m.id === "hospital-visits"));
    assert.equal(db.all("moduleInterest").length, 0, "interest for a deleted module is removed");
    // Deleted defaults stay deleted: the catalog is only seeded once.
    assert.equal((await call("DELETE", "/platform/modules/welfare", ops.token)).status, 204);
    assert.ok(!(await call("GET", "/modules", pastor.token)).body.modules.some((m: Json) => m.id === "welfare"));

    const actions = (await call("GET", "/platform/audit", ops.token)).body.map((e: Json) => e.action);
    for (const action of ["module_created", "module_updated", "module_deleted"]) assert.ok(actions.includes(action), action);
  });
});

describe("Message Prep", () => {
  test("formatting is kept, but anything unsafe is removed before saving", async () => {
    const pastor = await ownerWithChurch();
    const draft = await call("POST", "/messages", pastor.token, { title: "Formatting" });
    const saved = await call("PATCH", `/messages/${draft.body.id}`, pastor.token, {
      outline:
        '<h2>Point one</h2><p><strong>Bold</strong>, <em>italic</em>, <u>underlined</u> and <a href="https://bible.com">a link</a>.</p>' +
        '<script>alert(1)</script><p onclick="steal()">Hi<img src=x onerror="alert(2)"></p><a href="javascript:alert(3)">bad</a><ul><li>One</li></ul>',
    });
    const html = saved.body.outline as string;
    for (const kept of ["<h2>Point one</h2>", "<strong>Bold</strong>", "<em>italic</em>", "<u>underlined</u>", "<li>One</li>"]) {
      assert.ok(html.includes(kept), kept);
    }
    assert.match(html, /<a href="https:\/\/bible.com" target="_blank" rel="noopener noreferrer nofollow">a link<\/a>/);
    for (const removed of ["script", "alert", "onclick", "onerror", "<img", "javascript:"]) {
      assert.ok(!html.includes(removed), `${removed} must be removed`);
    }
    assert.equal(saved.body.wordCount, 11);
  });

  test("a pastor captures an idea, writes a message and sees only their own", async () => {
    const pastor = await ownerWithChurch();
    const idea = await call("POST", "/messages", pastor.token, { title: "The vine and the branches", status: "idea" });
    assert.equal(idea.status, 201, JSON.stringify(idea.body));
    assert.equal(idea.body.status, "idea");

    const saved = await call("PATCH", `/messages/${idea.body.id}`, pastor.token, {
      status: "drafting",
      scriptures: "John 15:1-11",
      series: "Abide",
      preachDate: "2026-11-01",
      theme: "Fruit comes from staying close to Jesus.",
      outline: "1. The vine\n2. The pruning\n3. The fruit",
      application: "Stay connected this week.",
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.wordCount, 13);
    assert.equal(saved.body.preachDate, "2026-11-01");
    assert.equal(
      (await call("GET", `/messages/${idea.body.id}`, pastor.token)).body.outline,
      "<p>1. The vine<br />2. The pruning<br />3. The fruit</p>",
      "plain text is stored as formatted paragraphs",
    );
    assert.equal((await call("PATCH", `/messages/${idea.body.id}`, pastor.token, { preachDate: "next sunday" })).status, 400);

    // Another pastor in the same church cannot see or touch it.
    const colleague = await member(pastor.token, "pastor");
    assert.equal((await call("GET", "/messages", colleague.token)).body.length, 0);
    assert.equal((await call("GET", `/messages/${idea.body.id}`, colleague.token)).status, 404);
    assert.equal((await call("PATCH", `/messages/${idea.body.id}`, colleague.token, { title: "Mine now" })).status, 404);
    assert.equal((await call("DELETE", `/messages/${idea.body.id}`, colleague.token)).status, 404);

    assert.equal((await call("GET", "/messages", pastor.token)).body.length, 1);
    assert.equal((await call("DELETE", `/messages/${idea.body.id}`, pastor.token)).status, 204);
    assert.equal((await call("GET", "/messages", pastor.token)).body.length, 0);
  });

  test("is for pastors only, and closed when the module is off", async () => {
    const pastor = await ownerWithChurch();
    for (const role of ["staff", "admin", "finance"]) {
      const person = await member(pastor.token, role);
      assert.equal((await call("GET", "/messages", person.token)).status, 403, role);
      assert.equal((await call("POST", "/messages", person.token, { title: "x" })).status, 403, role);
    }
    await call("PATCH", "/modules/message-prep", pastor.token, { enabled: false });
    assert.equal((await call("GET", "/messages", pastor.token)).status, 403);
    // Pastora's admin tools never see message content.
    await call("PATCH", "/modules/message-prep", pastor.token, { enabled: true });
    await call("POST", "/messages", pastor.token, { title: "Hidden sermon title" });
    const ops = user({ email: "ops2@pastora.test" });
    auth.users.get(ops.uid)!.platformAdmin = true;
    for (const path of ["/platform/workspaces", `/platform/workspaces/${pastor.church.id}`, "/platform/users", "/platform/modules"]) {
      assert.ok(!JSON.stringify((await call("GET", path, ops.token)).body).includes("Hidden sermon title"), path);
    }
  });
});

describe("Pastor's blog", () => {
  const publicBlog = (slug: string) => call("GET", `/public/churches/${slug}/posts`);
  const publicPost = (slug: string, id: string) => call("GET", `/public/churches/${slug}/posts/${id}`);

  test("drafts stay private; published posts are public and safe", async () => {
    const pastor = await ownerWithChurch();
    const draft = await call("POST", "/posts", pastor.token, { title: "Morning mercies" });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    assert.equal(draft.body.status, "draft");
    const id = draft.body.id;

    // Nothing public until it is published, and an empty post can't be published.
    assert.equal((await call("PATCH", `/posts/${id}`, pastor.token, { status: "published" })).status, 400);
    assert.equal((await publicPost(pastor.church.slug, id)).status, 404);
    assert.equal((await publicBlog(pastor.church.slug)).body.posts.length, 0);

    const saved = await call("PATCH", `/posts/${id}`, pastor.token, {
      scripture: "Lamentations 3:22-23",
      body: "<p>His mercies are <strong>new every morning</strong>.</p><script>steal()</script><p><img src=x onerror=alert(1)></p>",
    });
    assert.equal(saved.status, 200);
    assert.ok(!saved.body.body.includes("script") && !saved.body.body.includes("onerror"));
    const published = await call("PATCH", `/posts/${id}`, pastor.token, { status: "published" });
    assert.equal(published.body.status, "published");
    assert.ok(published.body.publishedAt);

    const blog = await publicBlog(pastor.church.slug);
    assert.equal(blog.status, 200);
    assert.equal(blog.body.church.name, "Grace Chapel");
    assert.equal(blog.body.posts[0].excerpt, "His mercies are new every morning.");
    assert.equal(blog.body.posts[0].authorName, "Pastor Ade");
    const post = await publicPost(pastor.church.slug, id);
    assert.equal(post.body.post.body, "<p>His mercies are <strong>new every morning</strong>.</p>");
    assert.equal((await call("GET", `/public/churches/${pastor.church.slug}`)).body.blogEnabled, true);

    // Unpublishing takes it down; publishing again keeps the first date.
    await call("PATCH", `/posts/${id}`, pastor.token, { status: "draft" });
    assert.equal((await publicPost(pastor.church.slug, id)).status, 404);
    const again = await call("PATCH", `/posts/${id}`, pastor.token, { status: "published" });
    assert.equal(again.body.publishedAt, published.body.publishedAt);
  });

  test("pastors see each other's published posts but only edit their own; others can't write", async () => {
    const pastor = await ownerWithChurch();
    const colleague = await member(pastor.token, "pastor");
    const staff = await member(pastor.token, "staff");
    const mine = await call("POST", "/posts", pastor.token, { title: "Draft thoughts" });
    const live = await call("POST", "/posts", pastor.token, { title: "Published thoughts" });
    await call("PATCH", `/posts/${live.body.id}`, pastor.token, { body: "<p>Hello church</p>", status: "published" });

    const seen = (await call("GET", "/posts", colleague.token)).body.map((p: Json) => p.title);
    assert.deepEqual(seen, ["Published thoughts"]);
    assert.equal((await call("GET", `/posts/${mine.body.id}`, colleague.token)).status, 404);
    assert.equal((await call("GET", `/posts/${live.body.id}`, colleague.token)).body.isMine, false);
    assert.equal((await call("PATCH", `/posts/${live.body.id}`, colleague.token, { title: "Edited" })).status, 404);
    assert.equal((await call("DELETE", `/posts/${live.body.id}`, colleague.token)).status, 404);
    assert.equal((await call("POST", "/posts", staff.token, { title: "x" })).status, 403);

    // Another church's slug never shows this church's posts.
    const other = await ownerWithChurch("Other Church");
    assert.equal((await publicPost(other.church.slug, live.body.id)).status, 404);
  });

  test("switching the blog off hides the public page; new built-in modules reach existing catalogs", async () => {
    const pastor = await ownerWithChurch();
    const live = await call("POST", "/posts", pastor.token, { title: "Hello" });
    await call("PATCH", `/posts/${live.body.id}`, pastor.token, { body: "<p>Hi</p>", status: "published" });
    await call("PATCH", "/modules/blog", pastor.token, { enabled: false });
    assert.equal((await publicBlog(pastor.church.slug)).status, 404);
    assert.equal((await publicPost(pastor.church.slug, live.body.id)).status, 404);
    assert.equal((await call("GET", `/public/churches/${pastor.church.slug}`)).body.blogEnabled, false);
    assert.equal((await call("GET", "/posts", pastor.token)).status, 403);

    // A catalog created before the blog existed gets it added automatically.
    db.store.delete("modules/blog");
    const modules = await call("GET", "/modules", pastor.token);
    assert.ok(modules.body.modules.some((m: Json) => m.id === "blog"));
  });
});
