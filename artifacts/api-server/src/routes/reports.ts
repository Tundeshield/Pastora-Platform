import { Router, type IRouter } from "express";
import {
  CreateReportBody,
  CreateReportResponse,
  ListReportsResponse,
  ReviewReportBody,
  ReviewReportParams,
  ReviewReportResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  hasRole,
  listTenantDocuments,
  notifyChurchRoles,
  recordWithId,
  tenantDocument,
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";

const router: IRouter = Router();
/** Staff submit reports for their department; pastors review them. */
const leaders = ["pastor", "staff"] as const;
const reviewers = ["pastor"] as const;

router.get("/reports", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before opening reports." });
      return;
    }
    if (!hasRole(context, [...leaders])) {
      res.status(403).json({ error: "Your role cannot view department reports." });
      return;
    }
    const reports = await listTenantDocuments("departmentReports", context.churchId);
    const visible = reports.filter(
      (report) =>
        hasRole(context, [...reviewers]) ||
        report.createdBy === user.uid ||
        report.department === context.membership.department,
    );
    res.json(
      ListReportsResponse.parse(
        visible
          .sort((a, b) => {
            const aTime = a.createdAt?.toDate?.().getTime?.() ?? 0;
            const bTime = b.createdAt?.toDate?.().getTime?.() ?? 0;
            return bTime - aTime;
          })
          .map((report) => recordWithId(report.id, report)),
      ),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load department reports.") });
  }
});

router.post("/reports", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before submitting reports." });
      return;
    }
    if (!hasRole(context, [...leaders])) {
      res.status(403).json({ error: "Your role cannot submit department reports." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("departmentReports").doc();
    await ref.set({
      churchId: context.churchId,
      ...parsed.data,
      status: "submitted",
      reviewComment: null,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    try {
      await notifyChurchRoles(
        context.churchId,
        ref.id,
        "report",
        "A department report is ready for review.",
        "/app/reports",
        ["pastor"],
      );
    } catch (notificationError) {
      req.log.warn({ notificationError }, "Report saved without review notification");
    }
    const saved = await ref.get();
    res.status(201).json(
      CreateReportResponse.parse(recordWithId(ref.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to submit this report.") });
  }
});

router.patch("/reports/:reportId", firebaseAuth, async (req, res): Promise<void> => {
  const params = ReviewReportParams.safeParse(req.params);
  const parsed = ReviewReportBody.safeParse(req.body);
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
      res.status(409).json({ error: "Complete church onboarding before reviewing reports." });
      return;
    }
    if (!hasRole(context, [...reviewers])) {
      res.status(403).json({ error: "Only a pastor can review department reports." });
      return;
    }
    const record = await tenantDocument(
      "departmentReports",
      params.data.reportId,
      context.churchId,
    );
    if (!record) {
      res.status(404).json({ error: "Department report not found." });
      return;
    }
    await record.ref.update({
      status: parsed.data.status,
      reviewComment: parsed.data.reviewComment ?? null,
      reviewedBy: user.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await getFirebaseServices().db.collection("auditLogs").add({
      churchId: context.churchId,
      actorUid: user.uid,
      action: "department_report_reviewed",
      recordId: params.data.reportId,
      createdAt: FieldValue.serverTimestamp(),
    });
    const saved = await record.ref.get();
    res.json(
      ReviewReportResponse.parse(recordWithId(saved.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to review this report.") });
  }
});

export default router;
