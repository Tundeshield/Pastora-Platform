/**
 * Pastora modules: optional features a church switches on, managed by Pastora's own
 * administrators from Pastora Admin.
 *
 * - The catalog lives in Firestore (`modules/{id}`), seeded once from DEFAULT_MODULES.
 *   Pastora admins add, edit, retire and delete entries; built-in modules (backed by
 *   product code) can be retired but not deleted.
 * - A church can use a module when it is available (or beta) and the church is
 *   entitled to it: early access is on, its plan includes the module, or Pastora
 *   granted it free. The church then switches it on or off.
 * - Product code checks `requireModule` on the server, so a switched-off module is
 *   closed even if someone calls the API directly.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseServices } from "./firebase-admin";
import type { ChurchRole } from "./pastora-data";

export type ModuleStatus = "available" | "beta" | "coming_soon" | "retired";
export type ModulePlan = "starter" | "church" | "plus" | "addon";
export type PlanTier = "starter" | "church" | "plus";

export type ModuleRecord = {
  id: string;
  name: string;
  description: string;
  status: ModuleStatus;
  plan: ModulePlan;
  roles: ChurchRole[];
  priceNote: string | null;
  builtin: boolean;
  sortOrder: number;
  /** Whether a church that has never touched the switch has it on. */
  defaultEnabled: boolean;
};

export const MODULES = "modules";
export const CHURCH_MODULES = "churchModules";
export const MODULE_INTEREST = "moduleInterest";
export const MODULE_SUGGESTIONS = "moduleSuggestions";
const SETTINGS_PATH = ["platformConfig", "settings"] as const;

const STATUSES: ModuleStatus[] = ["available", "beta", "coming_soon", "retired"];
const PLANS: ModulePlan[] = ["starter", "church", "plus", "addon"];
const TIERS: PlanTier[] = ["starter", "church", "plus"];
const ROLES: ChurchRole[] = ["pastor", "staff", "finance", "admin"];

export const DEFAULT_MODULES: ModuleRecord[] = [
  {
    id: "reports",
    name: "Department reports",
    description:
      "Department leaders submit weekly or monthly updates; pastors review them, ask for follow-up and spot what needs attention.",
    status: "available",
    plan: "church",
    roles: ["pastor", "staff"],
    priceNote: null,
    builtin: true,
    sortOrder: 10,
    defaultEnabled: true,
  },
  {
    id: "expenses",
    name: "Expenses & approvals",
    description:
      "Staff request spending, a pastor approves it and finance records the payment, with a full history and no one approving their own expense.",
    status: "available",
    plan: "church",
    roles: ["pastor", "staff", "finance"],
    priceNote: null,
    builtin: true,
    sortOrder: 20,
    defaultEnabled: true,
  },
  {
    id: "message-prep",
    name: "Message Prep",
    description:
      "Prepare Sunday messages and Bible studies: capture ideas through the week, build the outline, keep study notes and illustrations, and preach from a clean pulpit view. Private to each pastor.",
    status: "available",
    plan: "church",
    roles: ["pastor"],
    priceNote: null,
    builtin: true,
    sortOrder: 30,
    defaultEnabled: true,
  },
  {
    id: "blog",
    name: "Pastor's blog",
    description:
      "Share devotionals and reflections on a public page your members can read and pass on, without signing in. Write, format and publish when you're ready.",
    status: "available",
    plan: "starter",
    roles: ["pastor"],
    priceNote: null,
    builtin: true,
    sortOrder: 35,
    defaultEnabled: true,
  },
  {
    id: "messaging",
    name: "Messaging (SMS & WhatsApp)",
    description:
      "Appointment reminders, replies to people who asked to be contacted, and announcements to your team by text message and WhatsApp.",
    status: "coming_soon",
    plan: "addon",
    roles: ["pastor", "staff"],
    priceNote: "Priced by usage",
    builtin: false,
    sortOrder: 40,
    defaultEnabled: false,
  },
  {
    id: "prayer-team",
    name: "Prayer team",
    description:
      "A weekly prayer list for your intercessors, built only from requests marked “share with the prayer team”, with no names or contact details.",
    status: "coming_soon",
    plan: "starter",
    roles: ["pastor"],
    priceNote: null,
    builtin: false,
    sortOrder: 50,
    defaultEnabled: false,
  },
  {
    id: "events",
    name: "Events & programmes",
    description:
      "Plan services, special programmes and meetings, with an owner, deadlines and next steps for each event.",
    status: "coming_soon",
    plan: "church",
    roles: ["pastor", "staff"],
    priceNote: null,
    builtin: false,
    sortOrder: 60,
    defaultEnabled: false,
  },
  {
    id: "volunteers",
    name: "Volunteers & rotas",
    description: "Keep track of who serves where and when, and see which teams need more help.",
    status: "coming_soon",
    plan: "church",
    roles: ["pastor", "staff"],
    priceNote: null,
    builtin: false,
    sortOrder: 70,
    defaultEnabled: false,
  },
  {
    id: "welfare",
    name: "Welfare & benevolence",
    description:
      "Record requests for food, medical or emergency support and track assessment, approval and follow-up, visible to pastors only.",
    status: "coming_soon",
    plan: "church",
    roles: ["pastor"],
    priceNote: null,
    builtin: false,
    sortOrder: 80,
    defaultEnabled: false,
  },
  {
    id: "documents",
    name: "Church documents",
    description: "Keep policies, procedures and guidelines in one place, shared by role.",
    status: "coming_soon",
    plan: "church",
    roles: ["pastor", "staff", "finance", "admin"],
    priceNote: null,
    builtin: false,
    sortOrder: 90,
    defaultEnabled: false,
  },
  {
    id: "ask-pastora",
    name: "Ask Pastora (AI)",
    description:
      "Ask questions about your church's records in plain language and get summaries and drafts, limited to what you're allowed to see.",
    status: "coming_soon",
    plan: "plus",
    roles: ["pastor"],
    priceNote: null,
    builtin: false,
    sortOrder: 100,
    defaultEnabled: false,
  },
];

const BUILTIN_IDS = new Set(DEFAULT_MODULES.filter((m) => m.builtin).map((m) => m.id));

export class ModuleOffError extends Error {
  constructor(name: string) {
    super(`${name} isn't switched on for your church. A pastor or admin can turn it on in Modules.`);
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function moduleFrom(id: string, data: Record<string, unknown> | undefined): ModuleRecord {
  const fallback = DEFAULT_MODULES.find((m) => m.id === id);
  return {
    id,
    name: typeof data?.name === "string" ? data.name : (fallback?.name ?? id),
    description: typeof data?.description === "string" ? data.description : (fallback?.description ?? ""),
    status: pick(data?.status, STATUSES, fallback?.status ?? "coming_soon"),
    plan: pick(data?.plan, PLANS, fallback?.plan ?? "church"),
    roles: Array.isArray(data?.roles)
      ? (data.roles as unknown[]).filter((r): r is ChurchRole => ROLES.includes(r as ChurchRole))
      : (fallback?.roles ?? []),
    priceNote: typeof data?.priceNote === "string" && data.priceNote ? data.priceNote : null,
    // Only modules backed by product code are built in, whatever is stored.
    builtin: BUILTIN_IDS.has(id),
    sortOrder: typeof data?.sortOrder === "number" ? data.sortOrder : (fallback?.sortOrder ?? 1000),
    // Built-in modules take their default from the product code (it knows what they do).
    defaultEnabled:
      fallback?.builtin || typeof data?.defaultEnabled !== "boolean"
        ? (fallback?.defaultEnabled ?? false)
        : data.defaultEnabled,
  };
}

function settingsRef() {
  return getFirebaseServices().db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]);
}

/** Seeds the catalog once. After that, Pastora admins own it (deleted entries stay deleted). */
async function ensureCatalog(): Promise<void> {
  const { db } = getFirebaseServices();
  const settings = await settingsRef().get();
  if (settings.get("modulesSeeded") === true) return;
  await db.runTransaction(async (tx) => {
    const current = await tx.get(settingsRef());
    if (current.get("modulesSeeded") === true) return;
    const refs = DEFAULT_MODULES.map((m) => db.collection(MODULES).doc(m.id));
    const existing = await Promise.all(refs.map((ref) => tx.get(ref)));
    DEFAULT_MODULES.forEach((m, i) => {
      if (!existing[i].exists) {
        const { id: _id, ...data } = m;
        tx.set(refs[i], { ...data, createdAt: FieldValue.serverTimestamp() });
      }
    });
    tx.set(
      settingsRef(),
      {
        modulesSeeded: true,
        // Pastora starts in early access: every available module is free to use.
        earlyAccess: typeof current.get("earlyAccess") === "boolean" ? current.get("earlyAccess") : true,
      },
      { merge: true },
    );
  });
}

/**
 * Built-in modules ship with product code, so a catalog seeded before one existed
 * gets it added here. (Built-in modules can't be deleted, so a missing one is new.)
 */
async function addMissingBuiltins(present: Set<string>): Promise<boolean> {
  const missing = DEFAULT_MODULES.filter((m) => m.builtin && !present.has(m.id));
  if (!missing.length) return false;
  const { db } = getFirebaseServices();
  await db.runTransaction(async (tx) => {
    const refs = missing.map((m) => db.collection(MODULES).doc(m.id));
    const existing = await Promise.all(refs.map((ref) => tx.get(ref)));
    missing.forEach((m, i) => {
      if (existing[i].exists) return;
      const { id: _id, ...data } = m;
      tx.set(refs[i], { ...data, createdAt: FieldValue.serverTimestamp() });
    });
  });
  return true;
}

export async function loadCatalog(): Promise<ModuleRecord[]> {
  await ensureCatalog();
  let snap = await getFirebaseServices().db.collection(MODULES).get();
  if (await addMissingBuiltins(new Set(snap.docs.map((doc) => doc.id)))) {
    snap = await getFirebaseServices().db.collection(MODULES).get();
  }
  return snap.docs
    .map((doc) => moduleFrom(doc.id, doc.data()))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export type PlatformSettings = { earlyAccess: boolean; modulesVisible: boolean };

/**
 * While the Modules page is hidden (the default), every church gets these and
 * nothing else, plus any module Pastora Admin grants it. Keeps the menu short.
 */
export const CORE_MODULES = ["expenses", "message-prep", "blog"];

export async function getPlatformSettings(): Promise<PlatformSettings> {
  await ensureCatalog();
  const snap = await settingsRef().get();
  return { earlyAccess: snap.get("earlyAccess") !== false, modulesVisible: snap.get("modulesVisible") === true };
}

export async function updatePlatformSettings(patch: Partial<PlatformSettings>): Promise<PlatformSettings> {
  await ensureCatalog();
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "boolean"));
  if (Object.keys(clean).length) await settingsRef().set(clean, { merge: true });
  return getPlatformSettings();
}

export type ChurchAccess = {
  plan: PlanTier;
  grants: string[];
  enabled: Record<string, boolean>;
  interested: Set<string>;
};

export async function churchAccess(churchId: string, withInterest = false): Promise<ChurchAccess> {
  const { db } = getFirebaseServices();
  const [subscription, settings, interest] = await Promise.all([
    db.collection("subscriptions").doc(churchId).get(),
    db.collection(CHURCH_MODULES).doc(churchId).get(),
    withInterest
      ? db.collection(MODULE_INTEREST).where("churchId", "==", churchId).get()
      : Promise.resolve(null),
  ]);
  const enabledRaw = settings.get("enabled");
  return {
    plan: pick(subscription.get("planId"), TIERS, "starter"),
    grants: Array.isArray(settings.get("grants")) ? (settings.get("grants") as unknown[]).map(String) : [],
    enabled: enabledRaw && typeof enabledRaw === "object" ? (enabledRaw as Record<string, boolean>) : {},
    interested: new Set(interest ? interest.docs.map((doc) => String(doc.get("moduleId"))) : []),
  };
}

export function moduleState(
  module: ModuleRecord,
  access: ChurchAccess,
  earlyAccess: boolean,
  modulesVisible = true,
) {
  const usable = module.status === "available" || module.status === "beta";
  const granted = access.grants.includes(module.id);
  const planIncludes =
    module.plan !== "addon" && TIERS.indexOf(access.plan) >= TIERS.indexOf(module.plan as PlanTier);
  // With the Modules page hidden, churches can't switch anything, so the core set
  // plus Pastora Admin's grants decide what is on.
  const entitled = modulesVisible ? earlyAccess || granted || planIncludes : CORE_MODULES.includes(module.id) || granted;
  const enabled = modulesVisible ? (access.enabled[module.id] ?? module.defaultEnabled) : true;
  return {
    entitled,
    granted,
    enabled,
    active: usable && entitled && enabled,
    interested: access.interested.has(module.id),
  };
}

/** Ids of the modules a church can use right now. */
export async function activeModules(churchId: string): Promise<string[]> {
  const [catalog, settings, access] = await Promise.all([
    loadCatalog(),
    getPlatformSettings(),
    churchAccess(churchId),
  ]);
  return catalog
    .filter((m) => moduleState(m, access, settings.earlyAccess, settings.modulesVisible).active)
    .map((m) => m.id);
}

export async function isModuleActive(churchId: string, moduleId: string): Promise<boolean> {
  return (await activeModules(churchId)).includes(moduleId);
}

/** Throws ModuleOffError unless the module is active for this church. */
export async function requireModule(churchId: string, moduleId: string): Promise<void> {
  if (await isModuleActive(churchId, moduleId)) return;
  const name = DEFAULT_MODULES.find((m) => m.id === moduleId)?.name ?? "This module";
  throw new ModuleOffError(name);
}
