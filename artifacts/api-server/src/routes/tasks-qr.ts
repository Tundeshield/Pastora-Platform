import { Router, type IRouter } from "express";
import {
  CreateQrCodeBody,
  CreateQrCodeResponse,
  CreateTaskBody,
  CreateTaskResponse,
  ListQrCodesResponse,
  ListTasksResponse,
  UpdateQrCodeBody,
  UpdateQrCodeParams,
  UpdateQrCodeResponse,
  UpdateTaskBody,
  UpdateTaskParams,
  UpdateTaskResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  listTenantDocuments,
  notifyChurchUser,
  recordWithId,
  tenantDocument,
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { can } from "../lib/policies";

const router: IRouter = Router();

async function validAssignee(churchId: string, uid: string | null | undefined) {
  if (!uid) return true;
  const { db } = getFirebaseServices();
  const memberships = await db
    .collection("churchMemberships")
    .where("churchId", "==", churchId)
    .where("uid", "==", uid)
    .where("active", "==", true)
    .limit(1)
    .get();
  return !memberships.empty;
}

router.get("/tasks", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before opening tasks." });
      return;
    }
    const tasks = await listTenantDocuments("tasks", context.churchId);
    const visible = tasks.filter(
      (task) =>
        (context.role === "pastor") ||
        task.assignedTo === user.uid ||
        task.createdBy === user.uid,
    );
    res.json(
      ListTasksResponse.parse(
        visible
          .sort((a, b) => {
            const dueA = a.dueAt?.toDate?.().getTime?.() ?? Number.MAX_SAFE_INTEGER;
            const dueB = b.dueAt?.toDate?.().getTime?.() ?? Number.MAX_SAFE_INTEGER;
            return dueA - dueB;
          })
          .map((task) => recordWithId(task.id, task)),
      ),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load tasks.") });
  }
});

router.post("/tasks", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before creating tasks." });
      return;
    }
    // Everyone keeps their own tasks; only pastors assign work to other people.
    if (parsed.data.assignedTo && parsed.data.assignedTo !== user.uid && context.role !== "pastor") {
      res.status(403).json({ error: "Only a pastor can assign tasks to other people." });
      return;
    }
    if (!(await validAssignee(context.churchId, parsed.data.assignedTo))) {
      res.status(400).json({ error: "Choose an authorised church member." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("tasks").doc();
    await ref.set({
      churchId: context.churchId,
      title: parsed.data.title.trim(),
      description: parsed.data.description ?? null,
      priority: parsed.data.priority,
      status: "todo",
      assignedTo: parsed.data.assignedTo ?? null,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (parsed.data.assignedTo) {
      try {
        await notifyChurchUser(
          context.churchId,
          ref.id,
          parsed.data.assignedTo,
          "task",
          "A task was assigned to you.",
          "/app/tasks",
        );
      } catch (notificationError) {
        req.log.warn({ notificationError }, "Task saved without assignment notification");
      }
    }
    const saved = await ref.get();
    res.status(201).json(
      CreateTaskResponse.parse(recordWithId(ref.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to create this task.") });
  }
});

router.patch("/tasks/:taskId", firebaseAuth, async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  const parsed = UpdateTaskBody.safeParse(req.body);
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
      res.status(409).json({ error: "Complete church onboarding before updating tasks." });
      return;
    }
    const record = await tenantDocument("tasks", params.data.taskId, context.churchId);
    if (!record) {
      res.status(404).json({ error: "Task not found." });
      return;
    }
    if (
      !(context.role === "pastor") &&
      record.data.assignedTo !== user.uid &&
      record.data.createdBy !== user.uid
    ) {
      res.status(403).json({ error: "Your role cannot update this task." });
      return;
    }
    const isManagerOrCreator = (context.role === "pastor") || record.data.createdBy === user.uid;
    const changesBeyondStatus = Object.keys(parsed.data).some((key) => key !== "status");
    if (!isManagerOrCreator && changesBeyondStatus) {
      res.status(403).json({ error: "You can update the status of tasks assigned to you." });
      return;
    }
    if (!(await validAssignee(context.churchId, parsed.data.assignedTo))) {
      res.status(400).json({ error: "Choose an authorised church member." });
      return;
    }
    await record.ref.update({
      ...parsed.data,
      ...(parsed.data.dueAt !== undefined
        ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await record.ref.get();
    res.json(
      UpdateTaskResponse.parse(recordWithId(saved.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to update this task.") });
  }
});

router.get("/qr-codes", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before opening QR codes." });
      return;
    }
    if (!can(context, "qr")) {
      res.status(403).json({ error: "Your role cannot manage QR codes." });
      return;
    }
    const codes = await listTenantDocuments("qrCodes", context.churchId);
    res.json(
      ListQrCodesResponse.parse(
        codes
          .sort((a, b) => {
            const aTime = a.createdAt?.toDate?.().getTime?.() ?? 0;
            const bTime = b.createdAt?.toDate?.().getTime?.() ?? 0;
            return bTime - aTime;
          })
          .map((code) => recordWithId(code.id, code)),
      ),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load QR codes.") });
  }
});

router.post("/qr-codes", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateQrCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before creating QR codes." });
      return;
    }
    if (!can(context, "qr")) {
      res.status(403).json({ error: "Your role cannot create QR codes." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("qrCodes").doc();
    await ref.set({
      churchId: context.churchId,
      name: parsed.data.name.trim(),
      destination: parsed.data.destination,
      campaign: parsed.data.campaign ?? null,
      active: true,
      visits: 0,
      submissions: 0,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await ref.get();
    res.status(201).json(
      CreateQrCodeResponse.parse(recordWithId(ref.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to create this QR code.") });
  }
});

router.patch("/qr-codes/:qrCodeId", firebaseAuth, async (req, res): Promise<void> => {
  const params = UpdateQrCodeParams.safeParse(req.params);
  const parsed = UpdateQrCodeBody.safeParse(req.body);
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
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before updating QR codes." });
      return;
    }
    if (!can(context, "qr")) {
      res.status(403).json({ error: "Your role cannot update QR codes." });
      return;
    }
    const record = await tenantDocument("qrCodes", params.data.qrCodeId, context.churchId);
    if (!record) {
      res.status(404).json({ error: "QR code not found." });
      return;
    }
    await record.ref.update({
      ...parsed.data,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await record.ref.get();
    res.json(
      UpdateQrCodeResponse.parse(recordWithId(saved.id, saved.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to update this QR code.") });
  }
});

export default router;
