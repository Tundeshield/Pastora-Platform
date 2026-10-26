import type { ChurchRole } from "./pastora-data";

export function sameChurch(recordChurchId: unknown, activeChurchId: string): boolean {
  return typeof recordChurchId === "string" && recordChurchId === activeChurchId;
}

/** Prayer and counselling requests, private notes: pastors only. */
export function canViewPastoralCare(role: ChurchRole): boolean {
  return role === "pastor";
}

/**
 * What a person can see and do besides their own tasks. Pastors have everything;
 * everyone else has their role's defaults, which a pastor can adjust per person.
 * Counselling, private notes, Message Prep, the blog and approving expenses are never
 * permissions: they belong to pastors only.
 */
export const PERMISSIONS = ["enquiries", "prayer", "calendar", "qr", "reports", "expenses", "payments", "team"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Access to people's requests and the pastor's calendar, which only a pastor can give. */
export const CARE_PERMISSIONS: readonly Permission[] = ["enquiries", "prayer", "calendar"];

export const ROLE_DEFAULTS: Record<ChurchRole, readonly Permission[]> = {
  pastor: PERMISSIONS,
  staff: ["enquiries", "calendar", "qr", "reports", "expenses"],
  finance: ["expenses", "payments"],
  admin: ["team", "qr"],
  prayer_team: ["prayer"],
};

export function cleanPermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  return PERMISSIONS.filter((p) => value.includes(p));
}

/** A member's effective access: pastors get everything; others their stored or default list. */
export function permissionsFor(role: ChurchRole, stored: unknown): Permission[] {
  if (role === "pastor") return [...PERMISSIONS];
  return Array.isArray(stored) ? cleanPermissions(stored) : [...ROLE_DEFAULTS[role]];
}

export type Actor = { role: ChurchRole; permissions: readonly Permission[] };

export function can(actor: Actor, permission: Permission): boolean {
  return actor.role === "pastor" || actor.permissions.includes(permission);
}

/** Team, settings and modules: pastors and anyone given "team". */
export function canManageTeam(actor: Actor): boolean {
  return can(actor, "team");
}

/**
 * Care access (requests and the calendar) can only be given by a pastor, except while
 * a church has no pastor yet and is being set up. Returns the care permissions in
 * `next` that `actor` may not add.
 */
export function forbiddenCareGrants(
  actor: Actor,
  churchHasPastor: boolean,
  previous: readonly Permission[],
  next: readonly Permission[],
): Permission[] {
  if (actor.role === "pastor" || !churchHasPastor) return [];
  return next.filter((p) => CARE_PERMISSIONS.includes(p) && !previous.includes(p));
}

/**
 * Which care requests a person sees. Pastors: all. "enquiries": general enquiries.
 * "prayer": prayer requests the person chose to share with the prayer team.
 * Counselling is never shown to anyone but pastors.
 */
export function canSeeRequest(actor: Actor, request: { type?: unknown; shareWithPrayerTeam?: unknown }): boolean {
  if (actor.role === "pastor") return true;
  if (request.type === "general") return actor.permissions.includes("enquiries");
  if (request.type === "prayer") return actor.permissions.includes("prayer") && request.shareWithPrayerTeam === true;
  return false;
}

/** Changing a request's status: pastors, or "enquiries" for general enquiries. */
export function canUpdateRequest(actor: Actor, request: { type?: unknown }): boolean {
  return actor.role === "pastor" || (request.type === "general" && actor.permissions.includes("enquiries"));
}

export function canApproveExpense(
  role: ChurchRole,
  actorUid: string,
  requesterUid: unknown,
): boolean {
  return (
    role === "pastor" &&
    typeof requesterUid === "string" &&
    requesterUid !== actorUid
  );
}

export function canRecordExpensePayment(input: {
  actor: Actor;
  actorUid: string;
  requesterUid: unknown;
  approverUid: unknown;
  currentStatus: unknown;
}): boolean {
  return (
    input.actor.permissions.includes("payments") &&
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

export type ExpenseStatus = "submitted" | "approved" | "rejected" | "clarification" | "paid";

/**
 * Allowed expense transitions. Decisions (approve / reject / clarification) are only
 * possible while a request is awaiting review, so an approved request can never be
 * silently reversed or re-approved; "paid" is only reachable from "approved".
 */
export function expenseTransitionAllowed(from: unknown, to: ExpenseStatus): boolean {
  const allowed: Record<string, ExpenseStatus[]> = {
    submitted: ["approved", "rejected", "clarification"],
    clarification: ["approved", "rejected"],
    approved: ["paid"],
  };
  return typeof from === "string" && (allowed[from] ?? []).includes(to);
}

/**
 * Whether someone may invite a person with this role. Admins set churches up, so
 * they can invite the first pastor; once a church has a pastor, only a pastor can
 * add another, so an admin can never give themselves (or a second account) access
 * to pastoral care.
 */
export function canInviteRole(actor: Actor, role: ChurchRole, churchHasPastor: boolean): boolean {
  if (!canManageTeam(actor)) return false;
  if (role === "pastor" && actor.role !== "pastor") return !churchHasPastor;
  return true;
}

export type MemberChange = {
  actor: Actor;
  actorUid: string;
  targetUid: unknown;
  /** The member's current role. */
  targetRole: ChurchRole | null;
  /** The role being given, if the role is changing. */
  newRole?: ChurchRole;
  churchHasPastor: boolean;
};

/**
 * Pastors and admins manage the team, never their own membership. Only a pastor can
 * change or remove a pastor, or make someone a pastor once the church has one.
 * Because nobody can change themselves, a church always keeps the person making the
 * change, so it can never be left without someone able to manage the team.
 */
export function canManageMember(change: MemberChange): boolean {
  if (!canManageTeam(change.actor)) return false;
  if (typeof change.targetUid !== "string" || change.targetUid === change.actorUid) return false;
  if (!change.targetRole) return false;
  if (change.targetRole === "pastor" && change.actor.role !== "pastor") return false;
  if (change.newRole && change.newRole !== change.targetRole) {
    return canInviteRole(change.actor, change.newRole, change.churchHasPastor);
  }
  return true;
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56) || "church"
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const PALETTES = ["warm-cream", "modern-cool", "sage", "heritage-blue", "forest-dark"] as const;
export const FONT_FAMILIES = ["inter", "manrope", "roboto", "lora"] as const;
export const FONT_SIZES = ["small", "normal", "large"] as const;
export type Appearance = {
  theme: (typeof PALETTES)[number];
  fontFamily: (typeof FONT_FAMILIES)[number];
  fontSize: (typeof FONT_SIZES)[number];
};

/**
 * Reads the workspace appearance from stored settings. Workspaces created before
 * typography existed simply get the defaults, and their chosen palette is kept.
 * Unknown values (including the legacy "system") fall back to the defaults.
 */
export function appearanceFrom(settings: Record<string, unknown> | undefined | null): Appearance {
  const pick = <T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] =>
    typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
  return {
    theme: pick(settings?.theme, PALETTES, "warm-cream"),
    fontFamily: pick(settings?.fontFamily, FONT_FAMILIES, "inter"),
    fontSize: pick(settings?.fontSize, FONT_SIZES, "normal"),
  };
}

/**
 * Pastora's own administrators. Granted only on the server: a verified email in the
 * PLATFORM_ADMIN_EMAILS environment variable, or a `platformAdmin` custom claim set
 * with the Admin SDK. Nothing a browser sends can grant it.
 */
export function isPlatformAdmin(
  user: { email?: string; email_verified?: boolean; platformAdmin?: unknown } | null | undefined,
  allowList: string | undefined = process.env.PLATFORM_ADMIN_EMAILS,
): boolean {
  if (!user || user.email_verified !== true) return false;
  if (user.platformAdmin === true) return true;
  if (!user.email || !allowList) return false;
  const emails = allowList
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
  return emails.includes(normalizeEmail(user.email));
}
