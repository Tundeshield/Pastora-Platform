import { Router, type IRouter } from "express";
import {
  CreateAppointmentBody,
  CreateAppointmentResponse,
  GetAvailabilityResponse,
  SaveAvailabilityBody,
  SaveAvailabilityResponse,
  ListAppointmentsResponse,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  UpdateAppointmentResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  listTenantDocuments,
  recordWithId,
  tenantDocument,
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { appointmentTimesOverlap, can } from "../lib/policies";
import { availabilityFrom, cleanWeekly, validTimeZone } from "../lib/booking";
import { emailBooking } from "../lib/email";

const router: IRouter = Router();
/** Pastors, and anyone a pastor gives the calendar to, keep the pastor's diary. */

function timeOf(value: unknown): number {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime();
  return Number.NaN;
}

function overlaps(
  records: FirebaseFirestore.QueryDocumentSnapshot[],
  startAt: Date,
  durationMinutes: number,
  excludeId?: string,
): boolean {
  const start = startAt.getTime();
  return records.some((record) => {
    if (record.id === excludeId) return false;
    const data = record.data();
    if (data.status !== "confirmed") return false;
    const existingStart = timeOf(data.startAt);
    const existingDuration = Number(data.durationMinutes ?? 45);
    return appointmentTimesOverlap(
      start,
      durationMinutes,
      existingStart,
      existingDuration,
    );
  });
}

router.get("/appointments", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before opening appointments." });
      return;
    }
    if (!can(context, "calendar")) {
      res.status(403).json({ error: "Your role cannot view appointments." });
      return;
    }
    const appointments = await listTenantDocuments("appointments", context.churchId);
    const normalized = appointments
      .sort((a, b) => timeOf(a.startAt) - timeOf(b.startAt))
      .map((item) => recordWithId(item.id, item));
    res.json(ListAppointmentsResponse.parse(normalized));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load appointments.") });
  }
});

router.post("/appointments", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before creating appointments." });
      return;
    }
    if (!can(context, "calendar")) {
      res.status(403).json({ error: "Your role cannot create appointments." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("appointments").doc();
    const startAt = new Date(parsed.data.startAt);
    const appointment = {
      churchId: context.churchId,
      requesterName: parsed.data.requesterName,
      contact: parsed.data.contact ?? null,
      startAt,
      durationMinutes: parsed.data.durationMinutes,
      format: parsed.data.format,
      status: parsed.data.status,
      topic: parsed.data.topic?.trim() || null,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.runTransaction(async (transaction) => {
      if (appointment.status === "confirmed") {
        const confirmedQuery = db
          .collection("appointments")
          .where("churchId", "==", context.churchId)
          .where("status", "==", "confirmed");
        const snapshot = await transaction.get(confirmedQuery);
        if (overlaps(snapshot.docs, startAt, appointment.durationMinutes)) {
          throw new Error("APPOINTMENT_CONFLICT");
        }
      }
      transaction.set(ref, appointment);
    });
    const snapshot = await ref.get();
    res.status(201).json(
      CreateAppointmentResponse.parse(recordWithId(ref.id, snapshot.data() ?? {})),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "APPOINTMENT_CONFLICT") {
      res.status(409).json({ error: "This time overlaps a confirmed appointment." });
      return;
    }
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to create the appointment.") });
  }
});

router.patch(
  "/appointments/:appointmentId",
  firebaseAuth,
  async (req, res): Promise<void> => {
    const params = UpdateAppointmentParams.safeParse(req.params);
    const parsed = UpdateAppointmentBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const context = await tenantFor(req);
      const user = authenticatedUser(req);
      if (!context || !user) {
        res.status(409).json({ error: "Complete church onboarding before updating appointments." });
        return;
      }
      if (!can(context, "calendar")) {
        res.status(403).json({ error: "Your role cannot update appointments." });
        return;
      }
      const appointment = await tenantDocument(
        "appointments",
        params.data.appointmentId,
        context.churchId,
      );
      if (!appointment) {
        res.status(404).json({ error: "Appointment not found." });
        return;
      }
      const startAt = parsed.data.startAt
        ? new Date(parsed.data.startAt)
        : new Date(timeOf(appointment.data.startAt));
      const durationMinutes =
        parsed.data.durationMinutes ?? Number(appointment.data.durationMinutes ?? 45);
      const status = parsed.data.status ?? appointment.data.status;

      await getFirebaseServices().db.runTransaction(async (transaction) => {
        if (status === "confirmed") {
          const confirmedQuery = getFirebaseServices()
            .db.collection("appointments")
            .where("churchId", "==", context.churchId)
            .where("status", "==", "confirmed");
          const snapshot = await transaction.get(confirmedQuery);
          if (
            overlaps(
              snapshot.docs,
              startAt,
              durationMinutes,
              params.data.appointmentId,
            )
          ) {
            throw new Error("APPOINTMENT_CONFLICT");
          }
        }
        transaction.update(appointment.ref, {
          ...parsed.data,
          ...(parsed.data.startAt ? { startAt } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await getFirebaseServices().db.collection("auditLogs").add({
        churchId: context.churchId,
        actorUid: user.uid,
        action: "appointment_updated",
        recordId: params.data.appointmentId,
        createdAt: FieldValue.serverTimestamp(),
      });
      const updated = await appointment.ref.get();
      const before = appointment.data.status;
      const after = updated.get("status");
      if (
        updated.get("source") === "public_portal" &&
        before !== after &&
        (after === "confirmed" || after === "declined" || after === "cancelled")
      ) {
        const stored = await getFirebaseServices().db.collection("availability").doc(context.churchId).get();
        await emailBooking({
          churchId: context.churchId,
          contact: updated.get("contact"),
          status: after,
          startAt: new Date(timeOf(updated.get("startAt"))),
          minutes: Number(updated.get("durationMinutes") ?? 45),
          format: String(updated.get("format") ?? "in-person"),
          location: (stored.get("location") as string | null) ?? null,
        }).catch((emailError) => req.log.warn({ emailError }, "Booking update email not sent"));
      }
      res.json(
        UpdateAppointmentResponse.parse(
          recordWithId(updated.id, updated.data() ?? {}),
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "APPOINTMENT_CONFLICT") {
        res.status(409).json({ error: "This time overlaps a confirmed appointment." });
        return;
      }
      if (failFirebaseSetup(res, error)) return;
      res.status(400).json({
        error: errorMessage(error, "Unable to update the appointment."),
      });
    }
  },
);

async function availabilityResponse(churchId: string) {
  const { db } = getFirebaseServices();
  const [stored, settings, church] = await Promise.all([
    db.collection("availability").doc(churchId).get(),
    db.collection("churchSettings").doc(churchId).get(),
    db.collection("churches").doc(churchId).get(),
  ]);
  const availability = availabilityFrom(stored.data(), settings.data() ?? {});
  return GetAvailabilityResponse.parse({
    ...availability,
    timeOff: availability.timeOff.map((t) => ({
      startAt: t.startAt.toISOString(),
      endAt: t.endAt.toISOString(),
      label: t.label ?? null,
    })),
    timeZone: validTimeZone(church.get("timeZone")),
  });
}

router.get("/availability", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding first." });
      return;
    }
    if (!can(context, "calendar")) {
      res.status(403).json({ error: "You don't have access to the pastor's calendar." });
      return;
    }
    res.json(await availabilityResponse(context.churchId));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load availability.") });
  }
});

router.put("/availability", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = SaveAvailabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the hours: each needs a day, a start and a later end." });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding first." });
      return;
    }
    if (!can(context, "calendar")) {
      res.status(403).json({ error: "You don't have access to the pastor's calendar." });
      return;
    }
    const input = parsed.data;
    const badRange = input.weekly.find((w) => w.end <= w.start);
    if (badRange) {
      res.status(400).json({ error: "Each block of hours must end after it starts." });
      return;
    }
    const badOff = input.timeOff.find((t) => t.endAt.getTime() <= t.startAt.getTime());
    if (badOff) {
      res.status(400).json({ error: "Time off must end after it starts." });
      return;
    }
    const { db } = getFirebaseServices();
    // Past time off is no longer useful; keep the list short.
    const timeOff = input.timeOff
      .filter((t) => t.endAt.getTime() > Date.now())
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((t) => ({ startAt: t.startAt, endAt: t.endAt, label: t.label?.trim() || null }));
    const batch = db.batch();
    batch.set(db.collection("availability").doc(context.churchId), {
      churchId: context.churchId,
      weekly: cleanWeekly(input.weekly),
      meetingMinutes: input.meetingMinutes,
      bufferMinutes: input.bufferMinutes,
      noticeHours: input.noticeHours,
      horizonDays: input.horizonDays,
      autoConfirm: input.autoConfirm,
      formats: [...new Set(input.formats)],
      location: input.location?.trim() || null,
      timeOff,
      updatedBy: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      db.collection("churchSettings").doc(context.churchId),
      { appointmentEnabled: input.bookingEnabled, appointmentDurationMinutes: input.meetingMinutes },
      { merge: true },
    );
    batch.set(db.collection("auditLogs").doc(), {
      churchId: context.churchId,
      actorUid: user.uid,
      action: "availability_updated",
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    res.json(SaveAvailabilityResponse.parse(await availabilityResponse(context.churchId)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to save availability.") });
  }
});

export default router;
