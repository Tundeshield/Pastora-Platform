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
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { canApproveExpense, canRecordExpensePayment, expenseTransitionAllowed } from "../lib/policies";

const router: IRouter = Router();
const approvers = ["owner", "pastor"] as const;
const submitters = ["owner", "pastor", "staff", "department_leader", "finance"] as const;

router.get("/expenses", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before opening expenses." });
      return;
    }
    if (!hasRole(context, [...submitters])) {
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
    if (!hasRole(context, [...submitters])) {
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
    const status = parsed.data.status;
    if (!status) {
      res.status(400).json({ error: "Choose an action for this expense." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("financialRequests").doc(params.data.expenseId);
    // Read, authorise and write inside one transaction so two reviewers can never
    // both act on the same request, and the status machine cannot be bypassed.
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("churchId") !== context.churchId) {
        return { code: 404, error: "Expense request not found." } as const;
      }
      const current = snap.data() ?? {};
      if (!expenseTransitionAllowed(current.status, status)) {
        return {
          code: 409,
          error:
            current.status === "paid"
              ? "A recorded payment cannot be changed."
              : current.status === "approved"
                ? "This expense is already approved. Only a finance officer can record its payment."
                : `This expense can no longer be changed (status: ${String(current.status)}).`,
        } as const;
      }
      const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (status === "paid") {
        if (
          !canRecordExpensePayment({
            role: context.role,
            actorUid: user.uid,
            requesterUid: current.requesterId,
            approverUid: current.approvedBy,
            currentStatus: current.status,
          })
        ) {
          return {
            code: 403,
            error: "A finance officer who is neither the requester nor the approver must record the payment.",
          } as const;
        }
        const reference = parsed.data.paymentReference?.trim();
        if (!reference) {
          return { code: 400, error: "Add the real payment reference after the payment has been made." } as const;
        }
        update.status = "paid";
        update.paymentReference = reference;
        update.paymentRecordedBy = user.uid;
        update.paymentRecordedAt = FieldValue.serverTimestamp();
      } else {
        if (current.requesterId === user.uid) {
          return { code: 403, error: "You cannot review your own expense request." } as const;
        }
        if (!canApproveExpense(context.role, user.uid, current.requesterId)) {
          return { code: 403, error: "Only a pastor or the church owner can review expense requests." } as const;
        }
        if (status === "clarification" && !parsed.data.clarification?.trim()) {
          return { code: 400, error: "Explain what needs clarification." } as const;
        }
        update.status = status;
        update.reviewedBy = user.uid;
        update.reviewedAt = FieldValue.serverTimestamp();
        if (parsed.data.clarification !== undefined) update.clarification = parsed.data.clarification;
        if (status === "approved") {
          update.approvedBy = user.uid;
          update.approvedAt = FieldValue.serverTimestamp();
          // Freeze what was approved so later edits elsewhere can be detected.
          update.approvedAmount = current.amount;
        }
      }
      tx.update(ref, update);
      tx.set(db.collection("auditLogs").doc(), {
        churchId: context.churchId,
        actorUid: user.uid,
        action: status === "paid" ? "expense_payment_recorded" : `expense_${status}`,
        recordId: ref.id,
        fromStatus: current.status,
        toStatus: status,
        amount: current.amount,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { code: 200 } as const;
    });
    if (outcome.code !== 200) {
      res.status(outcome.code).json({ error: outcome.error });
      return;
    }
    const record = { ref };
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
