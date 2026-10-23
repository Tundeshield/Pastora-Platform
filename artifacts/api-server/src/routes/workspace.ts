import { Router, type IRouter } from "express";
import {
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  GetDashboardResponse,
  GetSessionResponse,
  GetSetupStatusResponse,
  ListPlansResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  iso,
  listTenantDocuments,
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices, isFirebaseConfigured } from "../lib/firebase-admin";

const router: IRouter = Router();

router.get("/setup/status", (_req, res) => {
  const configured = isFirebaseConfigured();
  res.json(
    GetSetupStatusResponse.parse({
      firebaseConfigured: configured,
      publicPortalEnabled: configured,
      billingProviderConfigured: Boolean(process.env.PAYMENT_WEBHOOK_SECRET),
    }),
  );
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
        "Additional authorised staff accounts",
        "Department reports",
        "Expense approvals",
        "Enhanced operational views",
      ],
      limits: {},
    },
  ];
  res.json(ListPlansResponse.parse(plans));
});

router.get("/session", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const user = authenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    const context = await tenantFor(req);
    const { db } = getFirebaseServices();
    const profile = await db.collection("users").doc(user.uid).get();
    const displayName =
      (typeof profile.get("name") === "string" && profile.get("name")) ||
      (typeof user.name === "string" ? user.name : null) ||
      user.email?.split("@")[0] ||
      "Pastora user";
    const church = context
      ? await db.collection("churches").doc(context.churchId).get()
      : null;
    const churchData = church?.exists ? church.data() ?? {} : null;
    res.json(
      GetSessionResponse.parse({
        user: {
          uid: user.uid,
          name: displayName,
          email: user.email ?? "",
          role: context?.role ?? "owner",
        },
        church: churchData
          ? {
              id: context?.churchId,
              name: churchData.name,
              slug: churchData.slug,
              country: churchData.country ?? "Not set",
              timeZone: churchData.timeZone ?? "UTC",
              logoUrl: churchData.logoUrl ?? null,
            }
          : null,
        subscriptionStatus:
          typeof churchData?.subscriptionStatus === "string"
            ? churchData.subscriptionStatus
            : "setup_required",
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load your session.") });
  }
});

router.post("/onboarding", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const user = authenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    const { db } = getFirebaseServices();
    const existingMembership = await db
      .collection("churchMemberships")
      .where("uid", "==", user.uid)
      .where("active", "==", true)
      .limit(1)
      .get();
    if (!existingMembership.empty) {
      res.status(409).json({ error: "This account already belongs to a church workspace." });
      return;
    }

    const baseSlug =
      parsed.data.churchName
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 56) || "church";
    let slug = baseSlug;
    let suffix = 2;
    while (!(await db.collection("churches").where("slug", "==", slug).limit(1).get()).empty) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const churchRef = db.collection("churches").doc();
    const membershipRef = db.collection("churchMemberships").doc();
    const settingsRef = db.collection("churchSettings").doc(churchRef.id);
    const subscriptionRef = db.collection("subscriptions").doc(churchRef.id);
    const now = FieldValue.serverTimestamp();
    const church = {
      name: parsed.data.churchName.trim(),
      slug,
      phone: parsed.data.phone ?? null,
      country: parsed.data.country,
      timeZone: parsed.data.timeZone,
      logoUrl: null,
      ownerUid: user.uid,
      status: "active",
      subscriptionStatus: "setup_required",
      createdAt: now,
      updatedAt: now,
    };
    const userRef = db.collection("users").doc(user.uid);
    const batch = db.batch();
    batch.set(churchRef, church);
    batch.set(membershipRef, {
      churchId: churchRef.id,
      uid: user.uid,
      role: "owner",
      active: true,
      createdAt: now,
    });
    batch.set(settingsRef, {
      churchId: churchRef.id,
      theme: parsed.data.theme,
      welcomeMessage: "You are welcome to reach out. Our pastoral care team is here to listen.",
      emergencyNotice:
        "Pastora is not an emergency response service or a replacement for professional healthcare.",
      appointmentDurationMinutes: 45,
      appointmentEnabled: true,
      publicPortalEnabled: true,
      categories: ["General", "Family", "Health", "Guidance"],
      retentionDays: 0,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(subscriptionRef, {
      churchId: churchRef.id,
      planId: "starter",
      status: "setup_required",
      billingProvider: null,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(
      userRef,
      {
        uid: user.uid,
        name: parsed.data.pastorName.trim(),
        email: user.email ?? "",
        updatedAt: now,
      },
      { merge: true },
    );
    await batch.commit();

    res.status(201).json(
      CreateWorkspaceResponse.parse({
        user: {
          uid: user.uid,
          name: parsed.data.pastorName.trim(),
          email: user.email ?? "",
          role: "owner",
        },
        church: {
          id: churchRef.id,
          name: church.name,
          slug: church.slug,
          country: church.country,
          timeZone: church.timeZone,
          logoUrl: null,
        },
        subscriptionStatus: "setup_required",
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    req.log.error({ error }, "Unable to create church workspace");
    res.status(500).json({ error: "Unable to create the church workspace." });
  }
});

router.get("/dashboard", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before opening the dashboard." });
      return;
    }
    if (!["owner", "pastor", "counsellor", "staff"].includes(context.role)) {
      res.status(403).json({ error: "Your role does not have access to the dashboard." });
      return;
    }

    const [requests, appointments, tasks, reports, expenses] = await Promise.all([
      listTenantDocuments("pastoralRequests", context.churchId),
      listTenantDocuments("appointments", context.churchId),
      listTenantDocuments("tasks", context.churchId),
      ["owner", "pastor"].includes(context.role)
        ? listTenantDocuments("departmentReports", context.churchId)
        : Promise.resolve([]),
      ["owner", "pastor"].includes(context.role)
        ? listTenantDocuments("financialRequests", context.churchId)
        : Promise.resolve([]),
    ]);
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
        counsellingAwaitingReview: ["owner", "pastor", "counsellor"].includes(context.role)
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
