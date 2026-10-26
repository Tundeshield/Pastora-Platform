import { Router, type IRouter } from "express";
import {
  CreateAppointmentBody,
  CreateAppointmentResponse,
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

export default router;
