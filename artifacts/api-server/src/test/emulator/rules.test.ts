/**
 * Security Rules tests — run against the Firebase Emulator Suite:
 *   pnpm test:emulator        (from the repository root)
 *
 * Pastora's browsers never talk to Firestore or Storage directly: every read and
 * write goes through the API, which checks church membership and role. The rules
 * therefore deny all client access, and these tests prove that a signed-in member
 * cannot bypass the API to read or write any church's data — including their own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const root = path.resolve(import.meta.dirname, "../../../../..");
let env: RulesTestEnvironment;

const COLLECTIONS = [
  "churches",
  "churchMemberships",
  "churchSettings",
  "churchInvitations",
  "churchSlugs",
  "membershipLocks",
  "users",
  "pastoralRequests",
  "counsellingCases",
  "pastoralNotes",
  "appointments",
  "tasks",
  "qrCodes",
  "departmentReports",
  "financialRequests",
  "notifications",
  "subscriptions",
  "auditLogs",
];

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pastora",
    firestore: { rules: readFileSync(path.join(root, "firestore.rules"), "utf8") },
    storage: { rules: readFileSync(path.join(root, "storage.rules"), "utf8") },
  });
});
after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // Seed church A, with "pastor-a" as its owner, bypassing rules like the API does.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "churches/church-a"), { name: "Church A", ownerUid: "pastor-a", slug: "church-a" });
    await setDoc(doc(db, "churchMemberships/church-a_pastor-a"), {
      churchId: "church-a",
      uid: "pastor-a",
      role: "owner",
      active: true,
    });
    await setDoc(doc(db, "counsellingCases/case-1"), { churchId: "church-a", message: "Confidential" });
    await setDoc(doc(db, "financialRequests/exp-1"), { churchId: "church-a", status: "approved", amount: 100 });
  });
});

describe("Firestore rules", () => {
  test("anonymous visitors cannot read or write anything", async () => {
    const db = env.unauthenticatedContext().firestore();
    for (const name of COLLECTIONS) {
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, `${name}/x`), { churchId: "church-a" }));
    }
  });

  test("a church owner cannot bypass the API, even for their own church", async () => {
    const db = env.authenticatedContext("pastor-a", { email_verified: true }).firestore();
    await assertFails(getDoc(doc(db, "churches/church-a")));
    await assertFails(getDoc(doc(db, "counsellingCases/case-1")));
    await assertFails(updateDoc(doc(db, "financialRequests/exp-1"), { status: "rejected" }));
    await assertFails(updateDoc(doc(db, "churchMemberships/church-a_pastor-a"), { role: "finance" }));
  });

  test("another church's member cannot read church A's records", async () => {
    const db = env.authenticatedContext("pastor-b", { email_verified: true }).firestore();
    await assertFails(getDoc(doc(db, "counsellingCases/case-1")));
    await assertFails(getDocs(collection(db, "pastoralRequests")));
    await assertFails(setDoc(doc(db, "churchMemberships/church-a_pastor-b"), { churchId: "church-a", role: "owner" }));
  });

  test("forged custom claims grant nothing", async () => {
    const db = env.authenticatedContext("attacker", { platformOwner: true, role: "owner", churchId: "church-a" }).firestore();
    await assertFails(getDoc(doc(db, "churches/church-a")));
  });
});

describe("Storage rules", () => {
  test("no client can upload or download files", async () => {
    const anon = env.unauthenticatedContext().storage();
    const member = env.authenticatedContext("pastor-a").storage();
    for (const storage of [anon, member]) {
      await assertFails(uploadBytes(ref(storage, "churches/church-a/receipts/r.pdf"), new Uint8Array([1, 2, 3])));
      await assertFails(getBytes(ref(storage, "churches/church-a/receipts/r.pdf")));
    }
  });
});
