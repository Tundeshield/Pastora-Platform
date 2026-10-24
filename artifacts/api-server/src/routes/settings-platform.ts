import { Router, type IRouter } from "express";
import {
  GetSettingsResponse,
  ListNotificationsResponse,
  MarkNotificationReadParams,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  hasRole,
  recordWithId,
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { appearanceFrom } from "../lib/policies";

const router: IRouter = Router();

router.get("/settings", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before opening settings." });
      return;
    }
    if (!hasRole(context, ["pastor", "admin"])) {
      res.status(403).json({ error: "Only a pastor can view church settings." });
      return;
    }
    const { db } = getFirebaseServices();
    const [churchSnapshot, settingsSnapshot] = await Promise.all([
      db.collection("churches").doc(context.churchId).get(),
      db.collection("churchSettings").doc(context.churchId).get(),
    ]);
    if (!churchSnapshot.exists) {
      res.status(404).json({ error: "Church workspace not found." });
      return;
    }
    const church = churchSnapshot.data() ?? {};
    const settings = settingsSnapshot.data() ?? {};
    res.json(
      GetSettingsResponse.parse({
        church: {
          id: context.churchId,
          name: church.name,
          slug: church.slug,
          country: church.country,
          timeZone: church.timeZone,
          logoUrl: church.logoUrl ?? null,
        },
        ...appearanceFrom(settings),
        welcomeMessage: settings.welcomeMessage ?? "",
        emergencyNotice: settings.emergencyNotice ?? "",
        appointmentDurationMinutes: settings.appointmentDurationMinutes ?? 45,
        appointmentEnabled: settings.appointmentEnabled !== false,
        publicPortalEnabled: settings.publicPortalEnabled !== false,
        categories: Array.isArray(settings.categories) ? settings.categories : [],
        retentionDays: settings.retentionDays ?? 0,
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load church settings.") });
  }
});

router.patch("/settings", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before updating settings." });
      return;
    }
    if (!hasRole(context, ["pastor", "admin"])) {
      res.status(403).json({ error: "Only a pastor can update church settings." });
      return;
    }
    const { db } = getFirebaseServices();
    const now = FieldValue.serverTimestamp();
    const churchPatch: Record<string, unknown> = { updatedAt: now };
    if (parsed.data.name !== undefined) churchPatch.name = parsed.data.name.trim();
    if (parsed.data.phone !== undefined) churchPatch.phone = parsed.data.phone;
    if (parsed.data.country !== undefined) churchPatch.country = parsed.data.country;
    if (parsed.data.timeZone !== undefined) churchPatch.timeZone = parsed.data.timeZone;
    const settingsPatch: Record<string, unknown> = { updatedAt: now };
    for (const field of [
      "theme",
      "fontFamily",
      "fontSize",
      "welcomeMessage",
      "emergencyNotice",
      "appointmentDurationMinutes",
      "appointmentEnabled",
      "publicPortalEnabled",
      "categories",
      "retentionDays",
    ] as const) {
      const value = parsed.data[field];
      if (value !== undefined) settingsPatch[field] = value;
    }
    const batch = db.batch();
    batch.set(db.collection("churches").doc(context.churchId), churchPatch, { merge: true });
    batch.set(
      db.collection("churchSettings").doc(context.churchId),
      { churchId: context.churchId, ...settingsPatch },
      { merge: true },
    );
    await batch.commit();

    const [churchSnapshot, settingsSnapshot] = await Promise.all([
      db.collection("churches").doc(context.churchId).get(),
      db.collection("churchSettings").doc(context.churchId).get(),
    ]);
    const church = churchSnapshot.data() ?? {};
    const settings = settingsSnapshot.data() ?? {};
    res.json(
      UpdateSettingsResponse.parse({
        church: {
          id: context.churchId,
          name: church.name,
          slug: church.slug,
          country: church.country,
          timeZone: church.timeZone,
          logoUrl: church.logoUrl ?? null,
        },
        ...appearanceFrom(settings),
        welcomeMessage: settings.welcomeMessage ?? "",
        emergencyNotice: settings.emergencyNotice ?? "",
        appointmentDurationMinutes: settings.appointmentDurationMinutes ?? 45,
        appointmentEnabled: settings.appointmentEnabled !== false,
        publicPortalEnabled: settings.publicPortalEnabled !== false,
        categories: Array.isArray(settings.categories) ? settings.categories : [],
        retentionDays: settings.retentionDays ?? 0,
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to update church settings.") });
  }
});

router.get("/notifications", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before opening notifications." });
      return;
    }
    const { db } = getFirebaseServices();
    const snapshots = await db
      .collection("notifications")
      .where("churchId", "==", context.churchId)
      .where("uid", "==", user.uid)
      .limit(100)
      .get();
    const notifications = snapshots.docs
      .map((doc) => recordWithId(doc.id, doc.data()))
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(String(a.createdAt)).getTime() : 0;
        const bTime = b.createdAt ? new Date(String(b.createdAt)).getTime() : 0;
        return bTime - aTime;
      });
    res.json(ListNotificationsResponse.parse(notifications));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load notifications.") });
  }
});

router.post(
  "/notifications/:notificationId/read",
  firebaseAuth,
  async (req, res): Promise<void> => {
    const params = MarkNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    try {
      const context = await tenantFor(req);
      const user = authenticatedUser(req);
      if (!context || !user) {
        res.status(409).json({ error: "Complete church onboarding before updating notifications." });
        return;
      }
      const { db } = getFirebaseServices();
      const ref = db.collection("notifications").doc(params.data.notificationId);
      const notification = await ref.get();
      if (
        !notification.exists ||
        notification.get("churchId") !== context.churchId ||
        notification.get("uid") !== user.uid
      ) {
        res.status(404).json({ error: "Notification not found." });
        return;
      }
      await ref.update({ read: true, readAt: FieldValue.serverTimestamp() });
      res.sendStatus(204);
    } catch (error) {
      if (failFirebaseSetup(res, error)) return;
      res.status(400).json({ error: errorMessage(error, "Unable to update notification.") });
    }
  },
);

export default router;
