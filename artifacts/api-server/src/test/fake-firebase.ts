/**
 * A small in-memory stand-in for the Firebase Admin SDK, used to run the real API
 * routes in tests without network access. It implements only what Pastora uses:
 * documents, equality queries with limit, batches, transactions (serialised),
 * serverTimestamp / increment transforms, and ID-token verification.
 *
 * It does NOT evaluate Firestore Security Rules — those are covered by the emulator
 * suite in tests/emulator (see README).
 */
import { Timestamp } from "firebase-admin/firestore";

type Data = Record<string, unknown>;

function isServerTimestamp(value: unknown): boolean {
  return (value as { methodName?: string })?.methodName === "FieldValue.serverTimestamp";
}
function isIncrement(value: unknown): value is { operand: number } {
  return (value as { methodName?: string })?.methodName === "FieldValue.increment";
}

function resolveValue(value: unknown, previous: unknown): unknown {
  if (isServerTimestamp(value)) return Timestamp.fromMillis(Date.now());
  if (isIncrement(value)) return (typeof previous === "number" ? previous : 0) + value.operand;
  if (value instanceof Date) return Timestamp.fromDate(value);
  return value;
}

function applyWrite(previous: Data | undefined, data: Data, merge: boolean): Data {
  const base: Data = merge && previous ? { ...previous } : {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    base[key] = resolveValue(value, previous?.[key]);
  }
  return base;
}

let autoId = 0;
function newId(): string {
  autoId += 1;
  return `id${autoId.toString(36).padStart(6, "0")}${Math.random().toString(36).slice(2, 8)}`;
}

export class FakeDocSnapshot {
  constructor(
    public ref: FakeDocRef,
    private value: Data | undefined,
  ) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value ? structuredCloneData(this.value) : undefined;
  }
  get(field: string) {
    return this.value?.[field];
  }
}

function structuredCloneData(data: Data): Data {
  return { ...data };
}

export class FakeDocRef {
  constructor(
    public db: FakeFirestore,
    public collectionName: string,
    public id: string,
  ) {}
  get path() {
    return `${this.collectionName}/${this.id}`;
  }
  async get() {
    return new FakeDocSnapshot(this, this.db.store.get(this.path));
  }
  async set(data: Data, options?: { merge?: boolean }) {
    this.db.write(this, data, Boolean(options?.merge), false);
  }
  async update(data: Data) {
    this.db.write(this, data, true, true);
  }
  async delete() {
    this.db.store.delete(this.path);
  }
}

export class FakeQuery {
  constructor(
    public db: FakeFirestore,
    public collectionName: string,
    private filters: Array<[string, unknown]> = [],
    private max = Infinity,
  ) {}
  where(field: string, op: string, value: unknown) {
    if (op !== "==") throw new Error(`Fake Firestore only supports == (got ${op})`);
    return new FakeQuery(this.db, this.collectionName, [...this.filters, [field, value]], this.max);
  }
  limit(n: number) {
    return new FakeQuery(this.db, this.collectionName, this.filters, n);
  }
  async get() {
    const docs: FakeDocSnapshot[] = [];
    for (const [path, value] of this.db.store) {
      const [collection, id] = path.split("/");
      if (collection !== this.collectionName) continue;
      if (this.filters.every(([field, expected]) => value[field] === expected)) {
        docs.push(new FakeDocSnapshot(new FakeDocRef(this.db, collection, id), value));
      }
      if (docs.length >= this.max) break;
    }
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

export class FakeCollection extends FakeQuery {
  constructor(db: FakeFirestore, name: string) {
    super(db, name);
  }
  doc(id?: string) {
    return new FakeDocRef(this.db, this.collectionName, id ?? newId());
  }
  async add(data: Data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

type PendingWrite = {
  ref: FakeDocRef;
  data: Data;
  merge: boolean;
  requireExists: boolean;
  requireMissing?: boolean;
};

export class FakeFirestore {
  store = new Map<string, Data>();
  private txQueue: Promise<unknown> = Promise.resolve();

  collection(name: string) {
    return new FakeCollection(this, name);
  }

  write(ref: FakeDocRef, data: Data, merge: boolean, requireExists: boolean) {
    const previous = this.store.get(ref.path);
    if (requireExists && !previous) throw new Error(`NOT_FOUND: ${ref.path}`);
    this.store.set(ref.path, applyWrite(previous, data, merge));
  }

  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map((ref) => ref.get()));
  }

  batch() {
    const writes: PendingWrite[] = [];
    return {
      set: (ref: FakeDocRef, data: Data, options?: { merge?: boolean }) => {
        writes.push({ ref, data, merge: Boolean(options?.merge), requireExists: false });
      },
      update: (ref: FakeDocRef, data: Data) => {
        writes.push({ ref, data, merge: true, requireExists: true });
      },
      commit: async () => {
        for (const w of writes) this.write(w.ref, w.data, w.merge, w.requireExists);
      },
    };
  }

  /** Transactions are serialised, which gives the same isolation guarantee tests rely on. */
  runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const run = async () => {
      const writes: PendingWrite[] = [];
      const tx = {
        get: (target: FakeDocRef | FakeQuery) => target.get(),
        set: (ref: FakeDocRef, data: Data, options?: { merge?: boolean }) => {
          writes.push({ ref, data, merge: Boolean(options?.merge), requireExists: false });
          return tx;
        },
        update: (ref: FakeDocRef, data: Data) => {
          writes.push({ ref, data, merge: true, requireExists: true });
          return tx;
        },
        create: (ref: FakeDocRef, data: Data) => {
          writes.push({ ref, data, merge: false, requireExists: false, requireMissing: true });
          return tx;
        },
        delete: (ref: FakeDocRef) => {
          writes.push({ ref, data: { __delete: true }, merge: false, requireExists: false });
          return tx;
        },
      };
      const result = await fn(tx);
      // Preconditions are checked for the whole commit before anything is written.
      for (const w of writes) {
        if (w.requireMissing && this.store.has(w.ref.path)) {
          throw Object.assign(new Error(`ALREADY_EXISTS: ${w.ref.path}`), { code: 6 });
        }
      }
      for (const w of writes) {
        if (w.data.__delete) this.store.delete(w.ref.path);
        else this.write(w.ref, w.data, w.merge, w.requireExists);
      }
      return result;
    };
    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => undefined);
    return next;
  }

  /** Test helper: every document in a collection. */
  all(collection: string): Array<Data & { id: string }> {
    return [...this.store]
      .filter(([path]) => path.startsWith(`${collection}/`))
      .map(([path, value]) => ({ id: path.split("/")[1], ...value }));
  }
}

export type FakeUser = {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  disabled?: boolean;
  platformAdmin?: boolean;
};

export class FakeAuth {
  users = new Map<string, FakeUser>();

  add(user: FakeUser) {
    this.users.set(user.uid, user);
    return `token:${user.uid}`;
  }

  private record(user: FakeUser) {
    return {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.name,
      disabled: user.disabled === true,
      customClaims: user.platformAdmin ? { platformAdmin: true } : undefined,
      metadata: { creationTime: new Date(0).toUTCString(), lastSignInTime: null },
    };
  }

  async verifyIdToken(token: string, checkRevoked = false) {
    const uid = token.startsWith("token:") ? token.slice(6) : "";
    const user = this.users.get(uid);
    if (!user) throw new Error("auth/argument-error");
    if (checkRevoked && user.disabled) throw Object.assign(new Error("auth/user-disabled"), { code: "auth/user-disabled" });
    return {
      uid,
      email: user.email,
      email_verified: user.emailVerified,
      name: user.name,
      ...(user.platformAdmin ? { platformAdmin: true } : {}),
    } as never;
  }

  async getUserByEmail(email: string) {
    const user = [...this.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) throw Object.assign(new Error("auth/user-not-found"), { code: "auth/user-not-found" });
    return this.record(user);
  }

  async getUser(uid: string) {
    const user = this.users.get(uid);
    if (!user) throw Object.assign(new Error("auth/user-not-found"), { code: "auth/user-not-found" });
    return this.record(user);
  }

  async getUsers(identifiers: { uid: string }[]) {
    return {
      users: identifiers.flatMap(({ uid }) => (this.users.has(uid) ? [this.record(this.users.get(uid)!)] : [])),
      notFound: [],
    };
  }

  async listUsers() {
    return { users: [...this.users.values()].map((user) => this.record(user)), pageToken: undefined };
  }

  async updateUser(uid: string, changes: { disabled?: boolean }) {
    const user = this.users.get(uid);
    if (!user) throw Object.assign(new Error("auth/user-not-found"), { code: "auth/user-not-found" });
    if (changes.disabled !== undefined) user.disabled = changes.disabled;
    return this.record(user);
  }

  revoked = new Set<string>();
  async revokeRefreshTokens(uid: string) {
    this.revoked.add(uid);
  }
}
