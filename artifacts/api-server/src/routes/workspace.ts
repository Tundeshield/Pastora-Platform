import { Router, type IRouter } from "express";
import {
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  GetDashboardResponse,
  GetEmailPreferencesResponse,
  SaveEmailPreferencesBody,
  SaveEmailPreferencesResponse,
  GetSessionResponse,
  GetSetupStatusResponse,
  ListPlansResponse,
} from "@workspace/api-zod";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  iso,
  listTenantDocuments,
  tenantFor,
  tenantForUser,
} from "../lib/pastora-data";
import { getFirebaseServices, isFirebaseConfigured } from "../lib/firebase-admin";
import { appearanceFrom, can, canSeeRequest, canViewPastoralCare, isPlatformAdmin } from "../lib/policies";
import { activeModules, getPlatformSettings } from "../lib/modules";
import { emailConfigured, preferencesFrom } from "../lib/email";
import {
  acceptPendingInvitation,
  createWorkspaceForUser,
  hasPendingInvitation,
  WorkspaceConflictError,
} from "../lib/workspace-service";

const router: IRouter = Router();

router.get("/setup/status", (_req, res) => {
  const configured = isFirebaseConfigured();
  res.json(
    GetSetupStatusResponse.parse({
      firebaseConfigured: configured,
      publicPortalEnabled: configured,
      billingProviderConfigured: Boolean(process.env.PAYMENT_WEBHOOK_SECRET),
      emailConfigured: emailConfigured(),
    }),
  );
});

async function emailPreferencesFor(uid: string, email: string | undefined) {
  const { db } = getFirebaseServices();
  const stored = await db.collection("emailPreferences").doc(uid).get();
  return GetEmailPreferencesResponse.parse({
    ...preferencesFrom(stored.data()),
    email: email ?? null,
    emailConfigured: emailConfigured(),
  });
}

router.get("/me/email-preferences", firebaseAuth, async (req, res): Promise<void> => {
  const user = authenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  try {
    res.json(await emailPreferencesFor(user.uid, user.email));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load your email settings.") });
  }
});

router.put("/me/email-preferences", firebaseAuth, async (req, res): Promise<void> => {
  const user = authenticatedUser(req);
  const parsed = SaveEmailPreferencesBody.safeParse(req.body);
  if (!user) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "Choose on or off for each kind of email." });
    return;
  }
  try {
    const { db } = getFirebaseServices();
    await db.collection("emailPreferences").doc(user.uid).set({
      uid: user.uid,
      ...parsed.data,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json(SaveEmailPreferencesResponse.parse(await emailPreferencesFor(user.uid, user.email)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to save your email settings.") });
  }
});

router.get("/plans", (_req, res) => {
  const plans = [
    {
      id: "starter",
      name: "Pastora Starter",
      description: "Core pastoral care and church workspace tools.",
      monthlyPrice: null,
      annualPrice: null,
      billingCurrency: null,
      configured: false,
      features: [
        "One church workspace",
        "One primary pastor account",
        "Prayer and counselling request management",
        "QR code generation",
        "Appointment requests and scheduling",
        "Basic tasks and reminders",
      ],
      limits: {},
    },
    {
      id: "pro",
      name: "Pastora Pro",
      description: "Expanded access for churches working with an authorised team.",
      monthlyPrice: null,
      annualPrice: null,
      billingCurrency: null,
      configured: false,
      features: [
        "Everything in Starter",
        "Accounts for assistant pastors, staff and finance",
        "Department reports",
        "Expense approvals",
        "Enhanced operational views",
      ],
      limits: {},
    },
  ];
  res.json(ListPlansResponse.parse(plans));
});

function churchSummary(id: string, data: Record<string, unknown>) {
  return {
    id,
    name: data.name,
    slug: data.slug,
    country: data.country ?? "Not set",
    timeZone: data.timeZone ?? "UTC",
    logoUrl: data.logoUrl ?? null,
  };
}

async function buildSession(user: DecodedIdToken) {
  const { db } = getFirebaseServices();
  let context = await tenantForUser(user, { allowSuspended: true });
  if (!context && (await acceptPendingInvitation(user))) {
    context = await tenantForUser(user, { allowSuspended: true });
  }
  const profile = await db.collection("users").doc(user.uid).get();
  const displayName =
    (typeof profile.get("name") === "string" && profile.get("name")) ||
    (typeof user.name === "string" ? user.name : null) ||
    user.email?.split("@")[0] ||
    "Pastora user";
  const [church, settings] = context
    ? await Promise.all([
        db.collection("churches").doc(context.churchId).get(),
        db.collection("churchSettings").doc(context.churchId).get(),
      ])
    : [null, null];
  const churchData = church?.exists ? (church.data() ?? {}) : null;
  return GetSessionResponse.parse({
    user: {
      uid: user.uid,
      name: displayName,
      email: user.email ?? "",
      // No church yet: the creator becomes a pastor unless they choose otherwise.
      role: context?.role ?? "pastor",
      permissions: context?.permissions ?? [],
    },
    church: churchData && context ? churchSummary(context.churchId, churchData) : null,
    subscriptionStatus:
      typeof churchData?.subscriptionStatus === "string" ? churchData.subscriptionStatus : "setup_required",
    ...appearanceFrom(settings?.data()),
    emailVerified: user.email_verified === true,
    invitationPending: !context && user.email_verified !== true ? await hasPendingInvitation(user.email) : false,
    churchSuspended: context?.suspended === true,
    platformAdmin: isPlatformAdmin(user),
    modules: context && !context.suspended ? await activeModules(context.churchId) : [],
    modulesVisible: (await getPlatformSettings()).modulesVisible,
  });
}

router.get("/session", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const user = authenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    res.json(await buildSession(user));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    req.log.error({ error }, "Unable to load session");
    res.status(400).json({ error: errorMessage(error, "Unable to load your session.") });
  }
});

router.post("/onboarding", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please complete all required workspace fields." });
    return;
  }
  const user = authenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (user.email_verified !== true) {
    res.status(403).json({ error: "Verify your email address before creating a church workspace." });
    return;
  }
  try {
    const result = await createWorkspaceForUser(user, parsed.data);
    res.status(result.created ? 201 : 200).json(CreateWorkspaceResponse.parse(await buildSession(user)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    if (error instanceof WorkspaceConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    req.log.error({ error }, "Unable to create church workspace");
    res.status(500).json({ error: "Unable to create the church workspace. Please try again." });
  }
});

router.get("/dashboard", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before opening the dashboard." });
      return;
    }
    const user = authenticatedUser(req);
    const pastor = canViewPastoralCare(context.role);
    const calendar = can(context, "calendar");
    if (!pastor && !calendar && !can(context, "enquiries") && !can(context, "prayer")) {
      res.status(403).json({ error: "The overview isn't part of your access." });
      return;
    }
    const modules = await activeModules(context.churchId);

    const [allRequests, appointments, allTasks, reports, expenses] = await Promise.all([
      listTenantDocuments("pastoralRequests", context.churchId),
      calendar ? listTenantDocuments("appointments", context.churchId) : Promise.resolve([]),
      listTenantDocuments("tasks", context.churchId),
      pastor && modules.includes("reports")
        ? listTenantDocuments("departmentReports", context.churchId)
        : Promise.resolve([]),
      pastor && modules.includes("expenses")
        ? listTenantDocuments("financialRequests", context.churchId)
        : Promise.resolve([]),
    ]);
    // Counts only include what this person may see.
    const requests = allRequests.filter((item) => canSeeRequest(context, item));
    const tasks = pastor
      ? allTasks
      : allTasks.filter((item) => item.createdBy === user?.uid || item.assignedTo === user?.uid);
    const now = Date.now();
    const upcoming = appointments
      .filter(
        (item) =>
          item.status === "confirmed" &&
          new Date(iso(item.startAt)).getTime() >= now,
      )
      .sort((a, b) => new Date(iso(a.startAt)).getTime() - new Date(iso(b.startAt)).getTime())
      .slice(0, 4)
      .map((item) => ({
        id: item.id,
        requesterName: item.requesterName ?? "Guest",
        startAt: iso(item.startAt),
        durationMinutes: item.durationMinutes ?? 45,
        format: item.format ?? "in-person",
        status: item.status,
        createdAt: iso(item.createdAt),
      }));
    const followUps = requests
      .filter(
        (item) =>
          item.dueAt &&
          new Date(iso(item.dueAt)).getTime() <= now + 48 * 60 * 60 * 1000 &&
          !["resolved", "closed"].includes(item.status),
      )
      .sort((a, b) => new Date(iso(a.dueAt)).getTime() - new Date(iso(b.dueAt)).getTime())
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        type: item.type,
        name: item.anonymous ? null : item.name ?? null,
        contact: null,
        category: item.category ?? null,
        message: "",
        status: item.status,
        assignedTo: item.assignedTo ?? null,
        nextAction: item.nextAction ?? null,
        dueAt: iso(item.dueAt),
        createdAt: iso(item.createdAt),
        anonymous: Boolean(item.anonymous),
        permissionToContact: Boolean(item.permissionToContact),
        shareWithPrayerTeam: Boolean(item.shareWithPrayerTeam),
      }));

    res.json(
      GetDashboardResponse.parse({
        newPrayerRequests: requests.filter(
          (item) => item.type === "prayer" && item.status === "new",
        ).length,
        counsellingAwaitingReview: pastor
          ? requests.filter(
              (item) => item.type === "counselling" && item.status === "new",
            ).length
          : 0,
        upcomingAppointments: upcoming.length,
        followUpsDue: requests.filter(
          (item) =>
            item.dueAt &&
            new Date(iso(item.dueAt)).getTime() < now &&
            !["resolved", "closed"].includes(item.status),
        ).length,
        overdueTasks: tasks.filter(
          (item) =>
            item.status !== "completed" &&
            item.dueAt &&
            new Date(iso(item.dueAt)).getTime() < now,
        ).length,
        reportsAwaitingReview: reports.filter((item) => item.status === "submitted").length,
        expensesAwaitingApproval: expenses.filter((item) => item.status === "submitted").length,
        nextAppointments: upcoming,
        urgentFollowUps: followUps,
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load dashboard data.") });
  }
});

export default router;
