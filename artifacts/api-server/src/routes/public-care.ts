import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  GetPublicChurchParams,
  GetPublicChurchResponse,
  GetPublicLinkParams,
  GetPublicLinkResponse,
  GetPublicSlotsParams,
  GetPublicSlotsResponse,
  SubmitPublicRequestBody,
  SubmitPublicRequestParams,
  SubmitPublicRequestResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { failFirebaseSetup, notifyChurchMembers } from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { isModuleActive } from "../lib/modules";
import { availabilityFrom, busyFrom, computeSlots, isOpenSlot, validTimeZone } from "../lib/booking";

const router: IRouter = Router();

// Overridable for automated tests; production uses the defaults.
const submissionsPerMinute = Number(process.env.PUBLIC_SUBMISSIONS_PER_MINUTE) || 8;
const publicSubmissionLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: submissionsPerMinute,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Please wait a little before sending another request." },
});

const qrVisitLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

/** Returns the QR code only if it belongs to the church and is active. */
async function activeQrCode(qrCodeId: string | null | undefined, churchId?: string) {
  if (!qrCodeId || !/^[A-Za-z0-9_-]{1,64}$/.test(qrCodeId)) return null;
  const { db } = getFirebaseServices();
  const snap = await db.collection("qrCodes").doc(qrCodeId).get();
  if (!snap.exists || snap.get("active") !== true) return null;
  if (churchId && snap.get("churchId") !== churchId) return null;
  return snap;
}

// Counts a scan. Always answers 204 so link ids cannot be probed, and stores no
// personal data (no IP, no user agent).
router.post("/public/qr-codes/:qrCodeId/visit", qrVisitLimit, async (req, res): Promise<void> => {
  try {
    const qr = await activeQrCode(String(req.params.qrCodeId));
    if (qr) await qr.ref.update({ visits: FieldValue.increment(1), lastVisitAt: FieldValue.serverTimestamp() });
  } catch (error) {
    req.log.warn({ error }, "QR visit not recorded");
  }
  res.sendStatus(204);
});

/** The church behind a public slug, with its settings, or null if its page is off. */
async function publicChurch(slug: string) {
  const { db } = getFirebaseServices();
  const result = await db
    .collection("churches")
    .where("slug", "==", slug)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (result.empty) return null;
  const church = result.docs[0];
  const settings = (await db.collection("churchSettings").doc(church.id).get()).data() ?? {};
  if (settings.publicPortalEnabled === false) return null;
  return { church, settings };
}

async function bookingState(churchId: string, settings: Record<string, unknown>) {
  const { db } = getFirebaseServices();
  const [stored, church, held] = await Promise.all([
    db.collection("availability").doc(churchId).get(),
    db.collection("churches").doc(churchId).get(),
    db
      .collection("appointments")
      .where("churchId", "==", churchId)
      .where("status", "in", ["confirmed", "requested"])
      .get(),
  ]);
  return {
    availability: availabilityFrom(stored.data(), settings),
    timeZone: validTimeZone(church.get("timeZone")),
    busy: busyFrom(held.docs.map((d) => ({ id: d.id, ...d.data() }))),
  };
}

const slotLookupLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

router.get("/public/churches/:slug/slots", slotLookupLimit, async (req, res): Promise<void> => {
  const params = GetPublicSlotsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const found = await publicChurch(params.data.slug);
    if (!found || found.settings.appointmentEnabled === false) {
      res.status(404).json({ error: "Booking is not available." });
      return;
    }
    const { availability, timeZone, busy } = await bookingState(found.church.id, found.settings);
    if (!availability.configured) {
      res.status(404).json({ error: "Booking is not available." });
      return;
    }
    res.json(
      GetPublicSlotsResponse.parse({
        timeZone,
        meetingMinutes: availability.meetingMinutes,
        formats: availability.formats,
        location: availability.location,
        autoConfirm: availability.autoConfirm,
        days: computeSlots(availability, timeZone, busy),
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    req.log.error({ error }, "Unable to load booking slots");
    res.status(500).json({ error: "Unable to load open times." });
  }
});

router.get("/public/churches/:slug/links/:qrCodeId", qrVisitLimit, async (req, res): Promise<void> => {
  const params = GetPublicLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "This link is not available." });
    return;
  }
  try {
    const found = await publicChurch(params.data.slug);
    const qr = found ? await activeQrCode(params.data.qrCodeId, found.church.id) : null;
    if (!qr) {
      res.status(404).json({ error: "This link is not available." });
      return;
    }
    res.json(
      GetPublicLinkResponse.parse({
        id: qr.id,
        destination: qr.get("destination"),
        headline: qr.get("headline") ?? null,
        message: qr.get("message") ?? null,
        campaign: qr.get("campaign") ?? null,
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(404).json({ error: "This link is not available." });
  }
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
    const stored = await db.collection("availability").doc(churchDoc.id).get();
    const bookingMode =
      settings.appointmentEnabled === false
        ? "off"
        : availabilityFrom(stored.data(), settings).configured
          ? "slots"
          : "request";

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
        blogEnabled: await isModuleActive(churchDoc.id, "blog"),
        bookingMode,
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
      res.status(400).json({ error: "Please check the form: a message is required and fields must not be too long." });
      return;
    }
    const input = parsed.data;
    if (input.type === "counselling" && !input.permissionToContact) {
      res.status(400).json({
        error: "Please consent to being contacted before sending a counselling request.",
      });
      return;
    }
    const preferred = input.preferredDate ? new Date(String(input.preferredDate)) : null;
    if (input.type === "appointment" && preferred && (Number.isNaN(preferred.getTime()) || preferred.getTime() < Date.now())) {
      res.status(400).json({ error: "Choose a preferred date and time in the future." });
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

      const qr = await activeQrCode(input.qrCodeId, churchDoc.id).catch(() => null);
      const campaign = (qr?.get("campaign") as string | null | undefined) ?? input.campaign ?? null;
      let reference: string;
      let appointmentStatus: "requested" | "confirmed" | null = null;
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
        const startAt =
          input.preferredDate instanceof Date ? input.preferredDate : new Date(String(input.preferredDate));
        const { availability, timeZone } = await bookingState(churchDoc.id, settings);
        const formats = availability.formats;
        const format =
          input.preferredFormat && (!availability.configured || formats.includes(input.preferredFormat))
            ? input.preferredFormat
            : formats[0] ?? "in-person";
        appointmentStatus = availability.configured && availability.autoConfirm ? "confirmed" : "requested";
        const appointment = {
          churchId: churchDoc.id,
          requesterName: input.anonymous ? "Guest" : input.name?.trim() || "Guest",
          contact: input.contact?.trim() || null,
          topic: input.message.trim() || null,
          startAt,
          durationMinutes: availability.meetingMinutes,
          format,
          status: appointmentStatus,
          createdAt: FieldValue.serverTimestamp(),
          source: "public_portal",
          campaign,
          qrCodeId: qr?.id ?? null,
        };
        if (availability.configured) {
          // The time must still be open when we save it, so two people can't take the same slot.
          await db.runTransaction(async (transaction) => {
            const held = await transaction.get(
              db
                .collection("appointments")
                .where("churchId", "==", churchDoc.id)
                .where("status", "in", ["confirmed", "requested"]),
            );
            const busy = busyFrom(held.docs.map((d) => ({ id: d.id, ...d.data() })));
            if (!isOpenSlot(startAt, availability, timeZone, busy)) throw new Error("SLOT_TAKEN");
            transaction.set(appointmentRef, appointment);
          });
        } else {
          await appointmentRef.set(appointment);
        }
        eventId = appointmentRef.id;
        reference = appointmentRef.id.slice(0, 8).toUpperCase();
        notificationType = "appointment";
        notificationTitle =
          appointmentStatus === "confirmed"
            ? `${appointment.requesterName} booked a conversation.`
            : "A new appointment request needs review.";
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
          campaign,
          qrCodeId: qr?.id ?? null,
          source: "public_portal",
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
            : input.type === "general" && input.category === "First-time guest"
              ? "A first-time guest filled in a welcome card."
              : "A new pastoral care request needs review.";
        targetPath = "/app/requests";
      }
      try {
        if (qr) await qr.ref.update({ submissions: FieldValue.increment(1) });
      } catch (qrError) {
        req.log.warn({ qrError }, "QR submission count not updated");
      }
      try {
        // Each request reaches pastors, plus whoever has access to that kind of request.
        const sharedPrayer = input.type === "prayer" && input.shareWithPrayerTeam === true;
        await notifyChurchMembers(churchDoc.id, eventId, notificationType, notificationTitle, targetPath, (role, permissions) => {
          if (role === "pastor") return true;
          if (input.type === "general") return permissions.includes("enquiries");
          if (input.type === "appointment") return permissions.includes("calendar");
          return sharedPrayer && permissions.includes("prayer");
        });
      } catch (notificationError) {
        req.log.warn({ notificationError }, "Pastoral request saved without notifications");
      }
      res.status(201).json(
        SubmitPublicRequestResponse.parse({ reference, received: true, appointmentStatus }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "SLOT_TAKEN") {
        res.status(409).json({ error: "Sorry, that time was just taken or is no longer open. Please choose another." });
        return;
      }
      if (failFirebaseSetup(res, error)) return;
      req.log.error({ error }, "Unable to save public care submission");
      res.status(500).json({
        error: "Your request could not be saved. Please try again later.",
      });
    }
  },
);

export default router;
