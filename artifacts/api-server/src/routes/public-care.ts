import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  GetPublicChurchParams,
  GetPublicChurchResponse,
  SubmitPublicRequestBody,
  SubmitPublicRequestParams,
  SubmitPublicRequestResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { failFirebaseSetup, notifyChurchRoles } from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";

const router: IRouter = Router();

const publicSubmissionLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Please wait a little before sending another request." },
});

router.get("/public/churches/:slug", async (req, res): Promise<void> => {
  const params = GetPublicChurchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const { db } = getFirebaseServices();
    const result = await db
      .collection("churches")
      .where("slug", "==", params.data.slug)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (result.empty) {
      res.status(404).json({ error: "This pastoral care page is not available." });
      return;
    }
    const churchDoc = result.docs[0];
    const settingsSnapshot = await db
      .collection("churchSettings")
      .doc(churchDoc.id)
      .get();
    const settings = settingsSnapshot.data() ?? {};
    if (settings.publicPortalEnabled === false) {
      res.status(404).json({ error: "This pastoral care page is not available." });
      return;
    }

    res.json(
      GetPublicChurchResponse.parse({
        name: churchDoc.get("name"),
        slug: churchDoc.get("slug"),
        logoUrl: churchDoc.get("logoUrl") ?? null,
        welcomeMessage: settings.welcomeMessage ?? "You are welcome to reach out.",
        categories: Array.isArray(settings.categories) ? settings.categories : [],
        appointmentEnabled: settings.appointmentEnabled !== false,
        emergencyNotice:
          settings.emergencyNotice ??
          "Pastora is not an emergency response service or a replacement for professional healthcare.",
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    req.log.error({ error }, "Unable to load public care page");
    res.status(500).json({ error: "Unable to load this pastoral care page." });
  }
});

router.post(
  "/public/churches/:slug/requests",
  publicSubmissionLimit,
  async (req, res): Promise<void> => {
    const params = SubmitPublicRequestParams.safeParse(req.params);
    const parsed = SubmitPublicRequestBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    if (input.type === "counselling" && !input.permissionToContact) {
      res.status(400).json({
        error: "Please consent to being contacted before sending a counselling request.",
      });
      return;
    }
    if (input.type === "appointment" && !input.preferredDate) {
      res.status(400).json({
        error: "Choose a preferred date and time for an appointment request.",
      });
      return;
    }

    try {
      const { db } = getFirebaseServices();
      const churchResult = await db
        .collection("churches")
        .where("slug", "==", params.data.slug)
        .where("status", "==", "active")
        .limit(1)
        .get();
      if (churchResult.empty) {
        res.status(404).json({ error: "This pastoral care page is not available." });
        return;
      }
      const churchDoc = churchResult.docs[0];
      const settingsSnapshot = await db
        .collection("churchSettings")
        .doc(churchDoc.id)
        .get();
      const settings = settingsSnapshot.data() ?? {};
      if (settings.publicPortalEnabled === false) {
        res.status(404).json({ error: "This pastoral care page is not available." });
        return;
      }

      let reference: string;
      let eventId: string;
      let notificationType: "appointment" | "pastoral_request";
      let notificationTitle: string;
      let targetPath: string;
      if (input.type === "appointment") {
        if (settings.appointmentEnabled === false) {
          res.status(404).json({ error: "Appointment requests are not currently available." });
          return;
        }
        const appointmentRef = db.collection("appointments").doc();
        await appointmentRef.set({
          churchId: churchDoc.id,
          requesterName: input.anonymous ? "Guest" : input.name?.trim() || "Guest",
          contact: input.contact?.trim() || null,
          startAt:
            input.preferredDate instanceof Date
              ? input.preferredDate
              : new Date(String(input.preferredDate)),
          durationMinutes: Number(settings.appointmentDurationMinutes) || 45,
          format: input.preferredFormat ?? "in-person",
          status: "requested",
          createdAt: FieldValue.serverTimestamp(),
          source: "public_portal",
        });
        eventId = appointmentRef.id;
        reference = appointmentRef.id.slice(0, 8).toUpperCase();
        notificationType = "appointment";
        notificationTitle = "A new appointment request needs review.";
        targetPath = "/app/appointments";
      } else {
        const requestRef = db.collection("pastoralRequests").doc();
        const requestData = {
          churchId: churchDoc.id,
          type: input.type,
          name:
            input.type === "counselling" || input.anonymous
              ? null
              : input.name?.trim() || null,
          status: "new",
          assignedTo: null,
          nextAction: null,
          dueAt: null,
          createdAt: FieldValue.serverTimestamp(),
          anonymous: input.anonymous,
          permissionToContact: input.permissionToContact,
          shareWithPrayerTeam:
            input.type === "prayer" && input.shareWithPrayerTeam,
          isConfidential: input.type === "counselling",
          campaign: input.campaign ?? null,
        };
        if (input.type === "counselling") {
          const caseRef = db.collection("counsellingCases").doc(requestRef.id);
          const batch = db.batch();
          batch.set(requestRef, {
            ...requestData,
            contact: null,
            category: "Confidential",
            message: "",
          });
          batch.set(caseRef, {
            churchId: churchDoc.id,
            requestId: requestRef.id,
            name: requestData.name,
            contact: input.contact?.trim() || null,
            category: input.category?.trim() || null,
            message: input.message.trim(),
            preferredFormat: input.preferredFormat ?? null,
            preferredAvailability: input.preferredAvailability ?? null,
            createdAt: FieldValue.serverTimestamp(),
          });
          await batch.commit();
        } else {
          await requestRef.set({
            ...requestData,
            contact: input.contact?.trim() || null,
            category: input.category?.trim() || null,
            message: input.message.trim(),
          });
        }
        eventId = requestRef.id;
        reference = requestRef.id.slice(0, 8).toUpperCase();
        notificationType = "pastoral_request";
        notificationTitle =
          input.type === "counselling"
            ? "A confidential care request needs review."
            : "A new pastoral care request needs review.";
        targetPath = "/app/requests";
      }
      try {
        await notifyChurchRoles(
          churchDoc.id,
          eventId,
          notificationType,
          notificationTitle,
          targetPath,
          ["owner", "pastor", "counsellor"],
        );
      } catch (notificationError) {
        req.log.warn({ notificationError }, "Pastoral request saved without notifications");
      }
      res.status(201).json(
        SubmitPublicRequestResponse.parse({ reference, received: true }),
      );
    } catch (error) {
      if (failFirebaseSetup(res, error)) return;
      req.log.error({ error }, "Unable to save public care submission");
      res.status(500).json({
        error: "Your request could not be saved. Please try again later.",
      });
    }
  },
);

export default router;
