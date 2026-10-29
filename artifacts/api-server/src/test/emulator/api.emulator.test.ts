/**
 * End-to-end API tests against the real Firestore and Auth emulators (real ID tokens,
 * real transactions and queries). Run from the repository root with:
 *   pnpm test:emulator
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";

process.env.LOG_LEVEL = "silent";
process.env.PUBLIC_SUBMISSIONS_PER_MINUTE = "10000";
process.env.FIREBASE_PROJECT_ID ??= "demo-pastora";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Run through `firebase emulators:exec` (pnpm test:emulator)");
assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST, "The Auth emulator must be running");

const { getFirebaseServices } = await import("../../lib/firebase-admin");
const { default: app } = await import("../../app");

const authHost = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;
let server: Server;
let base = "";
let counter = 0;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`, {
    method: "DELETE",
  });
  // These tests cover the full feature set, which sits behind Pastora Admin's Modules flag.
  await getFirebaseServices().db.collection("platformConfig").doc("settings").set({ modulesVisible: true }, { merge: true });
});
after(() => server?.close());

async function account(verified = true) {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const password = "correct-horse-battery";
  const signUp = await fetch(`${authHost}/accounts:signUp?key=demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then((r) => r.json() as Promise<{ localId: string; idToken: string }>);
  if (!verified) return { uid: signUp.localId, email, token: signUp.idToken };
  await getFirebaseServices().auth.updateUser(signUp.localId, { emailVerified: true });
  const signIn = await fetch(`${authHost}/accounts:signInWithPassword?key=demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then((r) => r.json() as Promise<{ idToken: string }>);
  return { uid: signUp.localId, email, token: signIn.idToken };
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const workspace = (name: string) => ({
  pastorName: "Pastor",
  churchName: name,
  country: "Nigeria",
  timeZone: "Africa/Lagos",
  theme: "warm-cream",
});

describe("with real Firebase emulators", () => {
  test("verification is required, and onboarding is idempotent under concurrency", async () => {
    const unverified = await account(false);
    assert.equal((await call("POST", "/onboarding", unverified.token, workspace("Unverified"))).status, 403);

    const pastor = await account();
    const results = await Promise.all([1, 2, 3].map(() => call("POST", "/onboarding", pastor.token, workspace("Emulator Chapel"))));
    const ids = new Set(results.map((r) => r.body.church.id));
    assert.equal(ids.size, 1, "concurrent submits must create exactly one workspace");
    const { db } = getFirebaseServices();
    const memberships = await db.collection("churchMemberships").where("uid", "==", pastor.uid).get();
    assert.equal(memberships.size, 1);
    assert.equal(memberships.docs[0].get("role"), "pastor");
  });

  test("tenant isolation, invitations and the expense workflow", async () => {
    const ownerA = await account();
    const ownerB = await account();
    await call("POST", "/onboarding", ownerA.token, workspace("Church A"));
    await call("POST", "/onboarding", ownerB.token, workspace("Church B"));

    const req = await call("POST", "/requests", ownerA.token, { type: "prayer", message: "Private prayer" });
    assert.equal(req.status, 201);
    assert.equal((await call("GET", "/requests", ownerB.token)).body.length, 0);
    assert.equal((await call("PATCH", `/requests/${req.body.id}`, ownerB.token, { status: "closed" })).status, 404);

    const leader = await account();
    const finance = await account();
    await call("POST", "/team/invitations", ownerA.token, { email: leader.email, role: "staff" });
    await call("POST", "/team/invitations", ownerA.token, { email: finance.email, role: "finance" });
    assert.equal((await call("GET", "/session", leader.token)).body.user.role, "staff");
    assert.equal((await call("GET", "/session", finance.token)).body.user.role, "finance");

    const expense = await call("POST", "/expenses", leader.token, { description: "Chairs", purpose: "Hall", amount: 9000 });
    assert.equal(expense.status, 201);
    const [first, second] = await Promise.all([
      call("PATCH", `/expenses/${expense.body.id}`, ownerA.token, { status: "approved" }),
      call("PATCH", `/expenses/${expense.body.id}`, ownerA.token, { status: "rejected" }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409], "only one decision can win");
    const decided = (await call("GET", "/expenses", ownerA.token)).body[0];
    if (decided.status === "approved") {
      assert.equal(
        (await call("PATCH", `/expenses/${expense.body.id}`, finance.token, { status: "paid", paymentReference: "TRX" })).status,
        200,
      );
    }
  });

  test("admin console: suspending a church and disabling an account take effect immediately", async () => {
    const ops = await account();
    const pastor = await account();
    process.env.PLATFORM_ADMIN_EMAILS = ops.email;
    try {
      const created = await call("POST", "/onboarding", pastor.token, workspace("Console Chapel"));
      const churchId = created.body.church.id;

      assert.equal((await call("GET", "/platform/workspaces", pastor.token)).status, 403);
      const users = await call("GET", "/platform/users", ops.token);
      assert.equal(users.status, 200);
      assert.ok(users.body.some((u: { uid: string; role: string }) => u.uid === pastor.uid && u.role === "pastor"));

      await call("PATCH", `/platform/workspaces/${churchId}`, ops.token, { status: "suspended" });
      assert.equal((await call("GET", "/requests", pastor.token)).status, 403);
      assert.equal((await call("GET", "/session", pastor.token)).body.churchSuspended, true);
      await call("PATCH", `/platform/workspaces/${churchId}`, ops.token, { status: "active" });
      assert.equal((await call("GET", "/requests", pastor.token)).status, 200);

      const disabled = await call("PATCH", `/platform/users/${pastor.uid}`, ops.token, { disabled: true });
      assert.equal(disabled.status, 200);
      // The token is still unexpired, but checkRevoked rejects disabled accounts.
      assert.equal((await call("GET", "/session", pastor.token)).status, 401);
      await call("PATCH", `/platform/users/${pastor.uid}`, ops.token, { disabled: false });
    } finally {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    }
  });

  test("modules: seeded once, switched per church and enforced", async () => {
    const pastor = await account();
    await call("POST", "/onboarding", pastor.token, workspace("Module Chapel"));
    // The Modules page sits behind a Pastora Admin flag; this test covers it switched on.
    await getFirebaseServices().db.collection("platformConfig").doc("settings").set({ modulesVisible: true }, { merge: true });
    const [a, b] = await Promise.all([call("GET", "/modules", pastor.token), call("GET", "/modules", pastor.token)]);
    assert.equal(a.status, 200);
    assert.equal(a.body.modules.length, b.body.modules.length, "concurrent first reads seed the catalog once");
    assert.ok((await call("GET", "/session", pastor.token)).body.modules.includes("reports"));
    await call("PATCH", "/modules/reports", pastor.token, { enabled: false });
    assert.equal((await call("GET", "/reports", pastor.token)).status, 403);
    await call("PATCH", "/modules/reports", pastor.token, { enabled: true });
    assert.equal((await call("GET", "/reports", pastor.token)).status, 200);
  });
});
