/**
 * Message Prep: each pastor's private workspace for Sunday messages and Bible studies.
 * A message belongs to the pastor who wrote it; no one else in the church (not even
 * other pastors) and no Pastora admin tool can read it.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateMessageBody,
  CreateMessageResponse,
  DeleteMessageParams,
  GetMessageParams,
  GetMessageResponse,
  ListMessagesResponse,
  UpdateMessageBody,
  UpdateMessageParams,
  UpdateMessageResponse,
} from "@workspace/api-zod";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import { moduleGate } from "../middlewares/module-gate";
import {
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  iso,
  tenantFor,
  type TenantContext,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { toSafeHtml, wordsIn } from "../lib/rich-text";

const router: IRouter = Router();
const SERMONS = "sermons";
const TEXT_FIELDS = ["outline", "study", "illustrations", "application"] as const;

function summary(id: string, data: DocumentData) {
  return {
    id,
    title: String(data.title ?? "Untitled message"),
    series: data.series ?? null,
    scriptures: data.scriptures ?? null,
    theme: data.theme ?? null,
    preachDate: data.preachDate ?? null,
    status: data.status ?? "idea",
    wordCount: Number(data.wordCount ?? 0),
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt ?? data.createdAt),
  };
}

function full(id: string, data: DocumentData) {
  return {
    ...summary(id, data),
    // Sections are formatted text (safe HTML); older plain-text notes are converted.
    outline: toSafeHtml(data.outline),
    study: toSafeHtml(data.study),
    illustrations: toSafeHtml(data.illustrations),
    application: toSafeHtml(data.application),
  };
}

/** Message Prep is for pastors; returns the caller's church context or answers the request. */
async function pastor(req: Request, res: Response): Promise<{ context: TenantContext; user: DecodedIdToken } | null> {
  const context = await tenantFor(req);
  const user = authenticatedUser(req);
  if (!context || !user) {
    res.status(409).json({ error: "Complete church onboarding first." });
    return null;
  }
  if (context.role !== "pastor") {
    res.status(403).json({ error: "Message Prep is for pastors." });
    return null;
  }
  return { context, user };
}

/** The pastor's own message, or null (other people's messages look like missing ones). */
async function ownMessage(
  id: string,
  churchId: string,
  uid: string,
): Promise<{ ref: DocumentReference; data: DocumentData } | null> {
  const ref = getFirebaseServices().db.collection(SERMONS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get("churchId") !== churchId || snap.get("authorUid") !== uid) return null;
  return { ref, data: snap.data() ?? {} };
}

router.get("/messages", firebaseAuth, moduleGate("message-prep"), async (req, res): Promise<void> => {
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const snap = await getFirebaseServices()
      .db.collection(SERMONS)
      .where("churchId", "==", who.context.churchId)
      .where("authorUid", "==", who.user.uid)
      .limit(1000)
      .get();
    const list = snap.docs
      .map((doc) => summary(doc.id, doc.data()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(ListMessagesResponse.parse(list));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load your messages.") });
  }
});

router.post("/messages", firebaseAuth, moduleGate("message-prep"), async (req, res): Promise<void> => {
  const body = CreateMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Give the message a title." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const ref = getFirebaseServices().db.collection(SERMONS).doc();
    const now = FieldValue.serverTimestamp();
    await ref.set({
      churchId: who.context.churchId,
      authorUid: who.user.uid,
      title: body.data.title.trim(),
      status: body.data.status ?? "drafting",
      series: body.data.series?.trim() || null,
      scriptures: body.data.scriptures?.trim() || null,
      preachDate: body.data.preachDate ?? null,
      theme: null,
      outline: "",
      study: "",
      illustrations: "",
      application: "",
      wordCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await ref.get();
    res.status(201).json(CreateMessageResponse.parse(full(ref.id, saved.data() ?? {})));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to start the message.") });
  }
});

router.get("/messages/:messageId", firebaseAuth, moduleGate("message-prep"), async (req, res): Promise<void> => {
  const params = GetMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid message." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const message = await ownMessage(params.data.messageId, who.context.churchId, who.user.uid);
    if (!message) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    res.json(GetMessageResponse.parse(full(message.ref.id, message.data)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to open the message.") });
  }
});

router.patch("/messages/:messageId", firebaseAuth, moduleGate("message-prep"), async (req, res): Promise<void> => {
  const params = UpdateMessageParams.safeParse(req.params);
  const body = UpdateMessageBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "These changes couldn't be saved; a field may be too long." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const message = await ownMessage(params.data.messageId, who.context.churchId, who.user.uid);
    if (!message) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    for (const [key, value] of Object.entries(body.data)) {
      if (value === undefined) continue;
      if (TEXT_FIELDS.includes(key as never)) update[key] = toSafeHtml(value);
      else update[key] = typeof value === "string" ? value.trim() || null : value;
    }
    if (typeof update.title !== "string" || !update.title) delete update.title;
    if (TEXT_FIELDS.some((field) => body.data[field] !== undefined)) {
      const merged = { ...message.data, ...update };
      update.wordCount = TEXT_FIELDS.reduce((total, field) => total + wordsIn(merged[field]), 0);
    }
    await message.ref.update(update);
    const saved = await message.ref.get();
    res.json(UpdateMessageResponse.parse(full(saved.id, saved.data() ?? {})));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to save the message.") });
  }
});

router.delete("/messages/:messageId", firebaseAuth, moduleGate("message-prep"), async (req, res): Promise<void> => {
  const params = DeleteMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid message." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const message = await ownMessage(params.data.messageId, who.context.churchId, who.user.uid);
    if (!message) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    await message.ref.delete();
    res.sendStatus(204);
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to delete the message.") });
  }
});

export default router;
