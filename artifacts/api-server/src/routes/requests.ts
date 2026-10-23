import { Router, type IRouter } from "express";
import {
  AddRequestNoteBody,
  AddRequestNoteParams,
  AddRequestNoteResponse,
  CreateRequestBody,
  CreateRequestResponse,
  ListRequestsQueryParams,
  ListRequestsResponse,
  UpdateRequestBody,
  UpdateRequestParams,
  UpdateRequestResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  hasRole,
  listTenantDocuments,
  recordWithId,
  tenantDocument,
  tenantFor,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { canViewCounselling } from "../lib/policies";

const router: IRouter = Router();
const pastoralRoles = ["owner", "pastor", "counsellor"] as const;

async function canAssignTo(churchId: string, uid: string): Promise<boolean> {
  const { db } = getFirebaseServices();
  const membership = await db
    .collection("churchMemberships")
    .where("churchId", "==", churchId)
    .where("uid", "==", uid)
    .where("active", "==", true)
    .limit(1)
    .get();
  return !membership.empty;
}

router.get("/requests", firebaseAuth, async (req, res): Promise<void> => {
  const query = ListRequestsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const context = await tenantFor(req);
    if (!context) {
      res.status(409).json({ error: "Complete church onboarding before opening requests." });
      return;
    }
    const documents = await listTenantDocuments("pastoralRequests", context.churchId);
    const visible = documents
      .filter((item) => {
        if (query.data.type && item.type !== query.data.type) return false;
        if (query.data.status && item.status !== query.data.status) return false;
        if (
          item.type === "counselling" &&
          !canViewCounselling(context.role)
        ) {
          return false;
        }
        if (
          ["staff", "department_leader", "finance"].includes(context.role) &&
          item.type !== "general"
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const createdA = a.createdAt?.toDate?.().getTime?.() ?? 0;
        const createdB = b.createdAt?.toDate?.().getTime?.() ?? 0;
        return createdB - createdA;
      });
    const response = await Promise.all(
      visible.map(async (item) => {
        const result = recordWithId(item.id, item);
        if (item.type === "counselling") {
          const { db } = getFirebaseServices();
          const details = await db.collection("counsellingCases").doc(item.id).get();
          const caseData = details.data() ?? {};
          result.name = caseData.name ?? null;
          result.contact = caseData.contact ?? null;
          result.category = caseData.category ?? null;
          result.message = caseData.message ?? "";
        } else {
          result.name = item.name ?? null;
          result.contact = item.contact ?? null;
          result.category = item.category ?? null;
          result.message = item.message ?? "";
        }
        return result;
      }),
    );
    res.json(ListRequestsResponse.parse(response));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load pastoral requests.") });
  }
});

router.post("/requests", firebaseAuth, async (req, res): Promise<void> => {
  const parsed = CreateRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const context = await tenantFor(req);
    const user = authenticatedUser(req);
    if (!context || !user) {
      res.status(409).json({ error: "Complete church onboarding before creating a request." });
      return;
    }
    if (!hasRole(context, [...pastoralRoles])) {
      res.status(403).json({ error: "Your role cannot create pastoral care records." });
      return;
    }
    const { db } = getFirebaseServices();
    const ref = db.collection("pastoralRequests").doc();
    const data = {
      churchId: context.churchId,
      type: parsed.data.type,
      name: parsed.data.type === "counselling" ? null : parsed.data.name ?? null,
      contact: parsed.data.type === "counselling" ? null : parsed.data.contact ?? null,
      category: parsed.data.type === "counselling" ? "Confidential" : parsed.data.category ?? null,
      message: parsed.data.type === "counselling" ? "" : parsed.data.message,
      status: "new",
      assignedTo: null,
      nextAction: null,
      dueAt: null,
      anonymous: false,
      permissionToContact: Boolean(parsed.data.contact),
      shareWithPrayerTeam: false,
      isConfidential: parsed.data.type === "counselling",
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (parsed.data.type === "counselling") {
      const batch = db.batch();
      batch.set(ref, data);
      batch.set(db.collection("counsellingCases").doc(ref.id), {
        churchId: context.churchId,
        requestId: ref.id,
        name: parsed.data.name ?? null,
        contact: parsed.data.contact ?? null,
        category: parsed.data.category ?? null,
        message: parsed.data.message,
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } else {
      await ref.set({
        ...data,
        name: parsed.data.name ?? null,
        contact: parsed.data.contact ?? null,
        category: parsed.data.category ?? null,
        message: parsed.data.message,
      });
    }
    const saved = await ref.get();
    const responseData = recordWithId(ref.id, saved.data() ?? {});
    if (parsed.data.type === "counselling") {
      responseData.name = parsed.data.name ?? null;
      responseData.contact = parsed.data.contact ?? null;
      responseData.category = parsed.data.category ?? null;
      responseData.message = parsed.data.message;
    }
    res.status(201).json(CreateRequestResponse.parse(responseData));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to create the request.") });
  }
});

router.patch("/requests/:requestId", firebaseAuth, async (req, res): Promise<void> => {
  const params = UpdateRequestParams.safeParse(req.params);
  const parsed = UpdateRequestBody.safeParse(req.body);
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
      res.status(409).json({ error: "Complete church onboarding before updating requests." });
      return;
    }
    if (!hasRole(context, [...pastoralRoles])) {
      res.status(403).json({ error: "Your role cannot manage pastoral care requests." });
      return;
    }
    const record = await tenantDocument(
      "pastoralRequests",
      params.data.requestId,
      context.churchId,
    );
    if (!record) {
      res.status(404).json({ error: "Request not found." });
      return;
    }
    if (
      record.data.type === "counselling" &&
      !hasRole(context, ["owner", "pastor", "counsellor"])
    ) {
      res.status(403).json({ error: "Your role cannot access counselling records." });
      return;
    }
    if (
      parsed.data.assignedTo &&
      !(await canAssignTo(context.churchId, parsed.data.assignedTo))
    ) {
      res.status(400).json({ error: "Choose an authorised staff member." });
      return;
    }
    await record.ref.update({
      ...parsed.data,
      ...(parsed.data.dueAt !== undefined
        ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await getFirebaseServices().db.collection("auditLogs").add({
      churchId: context.churchId,
      actorUid: user.uid,
      action: "pastoral_request_updated",
      recordId: params.data.requestId,
      createdAt: FieldValue.serverTimestamp(),
    });
    const updated = await record.ref.get();
    res.json(
      UpdateRequestResponse.parse(recordWithId(updated.id, updated.data() ?? {})),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to update this request.") });
  }
});

router.post(
  "/requests/:requestId/notes",
  firebaseAuth,
  async (req, res): Promise<void> => {
    const params = AddRequestNoteParams.safeParse(req.params);
    const parsed = AddRequestNoteBody.safeParse(req.body);
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
        res.status(409).json({ error: "Complete church onboarding before adding notes." });
        return;
      }
      if (!hasRole(context, [...pastoralRoles])) {
        res.status(403).json({ error: "Your role cannot add pastoral notes." });
        return;
      }
      const request = await tenantDocument(
        "pastoralRequests",
        params.data.requestId,
        context.churchId,
      );
      if (!request) {
        res.status(404).json({ error: "Request not found." });
        return;
      }
      if (
        request.data.type === "counselling" &&
        !hasRole(context, ["owner", "pastor", "counsellor"])
      ) {
        res.status(403).json({ error: "Your role cannot add notes to counselling records." });
        return;
      }
      const { db } = getFirebaseServices();
      const noteRef = db.collection("pastoralNotes").doc();
      await noteRef.set({
        churchId: context.churchId,
        requestId: params.data.requestId,
        note: parsed.data.note,
        authorUid: user.uid,
        restricted: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      await db.collection("auditLogs").add({
        churchId: context.churchId,
        actorUid: user.uid,
        action: "restricted_pastoral_note_created",
        recordId: params.data.requestId,
        createdAt: FieldValue.serverTimestamp(),
      });
      const note = await noteRef.get();
      res.status(201).json(
        AddRequestNoteResponse.parse(
          recordWithId(noteRef.id, note.data() ?? {}, ["createdAt"]),
        ),
      );
    } catch (error) {
      if (failFirebaseSetup(res, error)) return;
      res.status(400).json({ error: errorMessage(error, "Unable to save this private note.") });
    }
  },
);

export default router;
