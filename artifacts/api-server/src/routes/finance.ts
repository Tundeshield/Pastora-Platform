import { Router, type IRouter } from "express";
import {
  CreateExpenseBody,
  CreateExpenseResponse,
  ListExpensesResponse,
  UpdateExpenseBody,
  UpdateExpenseParams,
  UpdateExpenseResponse,
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
import { canApproveExpense, canRecordExpensePayment } from "../lib/policies";

const router: IRouter = Router();
const approvers = ["owner", "pastor"] as const;

router.get("/expenses", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before opening expenses." });
      return;
    }
    if (!hasRole(context, [...approvers, "finance"])) {
      res.status(403).json({ error: "Your role cannot view financial requests." });
      return;
    }
    const expenses = await listTenantDocuments("financialRequests", context.churchId);
    const visible = expenses.filter(
      (expense) =>
        hasRole(context, [...approvers, "finance"]) ||
        expense.requesterId === user.uid,
    );
    res.json(
      ListExpensesResponse.parse(
        visible
          .sort((a, b) => {
            const aTime = a.createdAt?.toDate?.().getTime?.() ?? 0;
            const bTime = b.createdAt?.toDate?.().getTime?.() ?? 0;
            return bTime - aTime;
          })
          .map((expense) => recordWithId(expense.id, expense)),
      ),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load expense requests.") });
  }
});

router.post("/expenses", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.receiptPath) {
    res.status(503).json({
      error: "Receipt uploads are unavailable until a protected Firebase Storage bucket is configured.",
    });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before submitting expenses." });
      return;
    }
    if (!hasRole(context, ["owner", "pastor", "staff", "department_leader", "finance"])) {
      res.status(403).json({ error: "Your role cannot submit expense requests." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("financialRequests").doc();
    await ref.set({
      churchId: context.churchId,
      description: parsed.data.description.trim(),
      purpose: parsed.data.purpose.trim(),
      amount: parsed.data.amount,
      currency: "NGN",
      department: parsed.data.department ?? null,
      status: "submitted",
      requesterId: user.uid,
      receiptPath: null,
      paymentReference: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    try {
      await notifyChurchRoles(
        context.churchId,
        ref.id,
        "expense",
        "An expense request is waiting for review.",
        "/app/expenses",
        ["owner", "pastor"],
      );
    } catch (notificationError) {
      req.log.warn({ notificationError }, "Expense saved without approval notification");
    }
    const saved = await ref.get();
    res.status(201).json(
      CreateExpenseResponse.parse(recordWithId(ref.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to submit this expense.") });
  }
});

router.patch("/expenses/:expenseId", firebaseAuth, async (req, res): Promise<void> => {
  const params = UpdateExpenseParams.safeParse(req.params);
  const parsed = UpdateExpenseBody.safeParse(req.body);
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
      res.status(409).json({ error: "Complete church onboarding before updating expenses." });
      return;
    }
    const record = await tenantDocument(
      "financialRequests",
      params.data.expenseId,
      context.churchId,
    );
    if (!record) {
      res.status(404).json({ error: "Expense request not found." });
      return;
    }
    const status = parsed.data.status;
    if (status === "paid") {
      if (record.data.status !== "approved") {
        res.status(409).json({ error: "Only an approved expense can be recorded as paid." });
        return;
      }
      if (!canRecordExpensePayment({
        role: context.role,
        actorUid: user.uid,
        requesterUid: record.data.requesterId,
        approverUid: record.data.approvedBy,
        currentStatus: record.data.status,
      })) {
        res.status(403).json({
          error: "A finance officer who is neither the requester nor approver must record the payment.",
        });
        return;
      }
      if (!parsed.data.paymentReference?.trim()) {
        res.status(400).json({
          error: "Add the real payment reference after the payment has been made.",
        });
        return;
      }
    } else {
      if (!status || !canApproveExpense(context.role, user.uid, record.data.requesterId)) {
        res.status(403).json({ error: "Only a pastor can approve, reject or request clarification." });
        return;
      }
      if (record.data.requesterId === user.uid) {
        res.status(403).json({ error: "You cannot approve your own expense request." });
        return;
      }
      if (record.data.status === "paid") {
        res.status(409).json({ error: "A recorded payment cannot be changed here." });
        return;
      }
    }
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (status === "paid") {
      update.status = "paid";
      update.paymentReference = parsed.data.paymentReference?.trim();
      update.paymentRecordedBy = user.uid;
      update.paymentRecordedAt = FieldValue.serverTimestamp();
    } else if (status) {
      update.status = status;
      update.reviewedBy = user.uid;
      update.reviewedAt = FieldValue.serverTimestamp();
      if (parsed.data.clarification !== undefined) {
        update.clarification = parsed.data.clarification;
      }
      if (status === "approved") update.approvedBy = user.uid;
    }
    await record.ref.update(update);
    await getFirebaseServices().db.collection("auditLogs").add({
      churchId: context.churchId,
      actorUid: user.uid,
      action: status === "paid" ? "expense_payment_recorded" : `expense_${status}`,
      recordId: params.data.expenseId,
      createdAt: FieldValue.serverTimestamp(),
    });
    const saved = await record.ref.get();
    res.json(
      UpdateExpenseResponse.parse(recordWithId(saved.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to update this expense.") });
  }
});

export default router;
