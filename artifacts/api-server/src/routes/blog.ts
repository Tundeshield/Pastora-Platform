/**
 * Pastor's blog: pastors write devotionals and reflections; once published, anyone
 * with the link can read them on the church's public blog page. Drafts are private to
 * their author. Post bodies are cleaned to a safe subset of HTML before saving.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreatePostBody,
  CreatePostResponse,
  DeletePostParams,
  GetPostParams,
  GetPostResponse,
  GetPublicBlogParams,
  GetPublicBlogResponse,
  GetPublicPostParams,
  GetPublicPostResponse,
  ListPostsResponse,
  UpdatePostBody,
  UpdatePostParams,
  UpdatePostResponse,
} from "@workspace/api-zod";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, type DocumentData, type DocumentReference, type DocumentSnapshot } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import { moduleGate } from "../middlewares/module-gate";
import {
  audit,
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  iso,
  optionalIso,
  tenantFor,
  type TenantContext,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { isModuleActive } from "../lib/modules";
import { richTextToPlain, toSafeHtml, wordsIn } from "../lib/rich-text";

const router: IRouter = Router();
const POSTS = "posts";

function excerpt(body: unknown): string {
  const text = richTextToPlain(body).replace(/\s+/g, " ").trim();
  return text.length > 220 ? `${text.slice(0, 217).replace(/\s+\S*$/, "")}…` : text;
}

function publicSummary(id: string, data: DocumentData) {
  return {
    id,
    title: String(data.title ?? "Untitled post"),
    scripture: data.scripture ?? null,
    excerpt: excerpt(data.body),
    authorName: String(data.authorName ?? "Pastor"),
    publishedAt: optionalIso(data.publishedAt),
  };
}

function summary(id: string, data: DocumentData, uid: string) {
  return {
    ...publicSummary(id, data),
    status: data.status === "published" ? "published" : "draft",
    isMine: data.authorUid === uid,
    wordCount: Number(data.wordCount ?? 0),
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt ?? data.createdAt),
  };
}

function full(id: string, data: DocumentData, uid: string) {
  return { ...summary(id, data, uid), body: toSafeHtml(data.body) };
}

async function pastor(req: Request, res: Response): Promise<{ context: TenantContext; user: DecodedIdToken } | null> {
  const context = await tenantFor(req);
  const user = authenticatedUser(req);
  if (!context || !user) {
    res.status(409).json({ error: "Complete church onboarding first." });
    return null;
  }
  if (context.role !== "pastor") {
    res.status(403).json({ error: "The blog is written by pastors." });
    return null;
  }
  return { context, user };
}

async function authorName(uid: string, fallback?: string): Promise<string> {
  const profile = await getFirebaseServices().db.collection("users").doc(uid).get();
  return (typeof profile.get("name") === "string" && profile.get("name")) || fallback || "Pastor";
}

/** A post this pastor may read: their own, or any published post in their church. */
async function readablePost(id: string, churchId: string, uid: string): Promise<DocumentSnapshot | null> {
  const snap = await getFirebaseServices().db.collection(POSTS).doc(id).get();
  if (!snap.exists || snap.get("churchId") !== churchId) return null;
  if (snap.get("authorUid") !== uid && snap.get("status") !== "published") return null;
  return snap;
}

async function ownPost(id: string, churchId: string, uid: string): Promise<{ ref: DocumentReference; data: DocumentData } | null> {
  const ref = getFirebaseServices().db.collection(POSTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get("churchId") !== churchId || snap.get("authorUid") !== uid) return null;
  return { ref, data: snap.data() ?? {} };
}

router.get("/posts", firebaseAuth, moduleGate("blog"), async (req, res): Promise<void> => {
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const snap = await getFirebaseServices().db.collection(POSTS).where("churchId", "==", who.context.churchId).limit(1000).get();
    const list = snap.docs
      .filter((doc) => doc.get("status") === "published" || doc.get("authorUid") === who.user.uid)
      .map((doc) => summary(doc.id, doc.data(), who.user.uid))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(ListPostsResponse.parse(list));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load posts.") });
  }
});

router.post("/posts", firebaseAuth, moduleGate("blog"), async (req, res): Promise<void> => {
  const body = CreatePostBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Give the post a title." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const ref = getFirebaseServices().db.collection(POSTS).doc();
    const now = FieldValue.serverTimestamp();
    await ref.set({
      churchId: who.context.churchId,
      authorUid: who.user.uid,
      authorName: await authorName(who.user.uid, who.user.name),
      title: body.data.title.trim(),
      scripture: null,
      body: "",
      status: "draft",
      publishedAt: null,
      wordCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await ref.get();
    res.status(201).json(CreatePostResponse.parse(full(ref.id, saved.data() ?? {}, who.user.uid)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to start the post.") });
  }
});

router.get("/posts/:postId", firebaseAuth, moduleGate("blog"), async (req, res): Promise<void> => {
  const params = GetPostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid post." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const snap = await readablePost(params.data.postId, who.context.churchId, who.user.uid);
    if (!snap) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    res.json(GetPostResponse.parse(full(snap.id, snap.data() ?? {}, who.user.uid)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to open the post.") });
  }
});

router.patch("/posts/:postId", firebaseAuth, moduleGate("blog"), async (req, res): Promise<void> => {
  const params = UpdatePostParams.safeParse(req.params);
  const body = UpdatePostBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "These changes couldn't be saved; the post may be too long." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const post = await ownPost(params.data.postId, who.context.churchId, who.user.uid);
    if (!post) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (body.data.title !== undefined && body.data.title.trim()) update.title = body.data.title.trim();
    if (body.data.scripture !== undefined) update.scripture = body.data.scripture?.trim() || null;
    if (body.data.body !== undefined) {
      update.body = toSafeHtml(body.data.body);
      update.wordCount = wordsIn(update.body);
    }
    if (body.data.status !== undefined && body.data.status !== post.data.status) {
      const finalBody = update.body ?? post.data.body;
      if (body.data.status === "published" && !richTextToPlain(finalBody)) {
        res.status(400).json({ error: "Write something before publishing." });
        return;
      }
      update.status = body.data.status;
      if (body.data.status === "published") {
        // The first publish date stays, so re-publishing after an edit keeps its place.
        if (!post.data.publishedAt) update.publishedAt = FieldValue.serverTimestamp();
        update.authorName = await authorName(who.user.uid, who.user.name);
      }
      await audit(who.context.churchId, who.user.uid, body.data.status === "published" ? "post_published" : "post_unpublished", post.ref.id);
    }
    await post.ref.update(update);
    const saved = await post.ref.get();
    res.json(UpdatePostResponse.parse(full(saved.id, saved.data() ?? {}, who.user.uid)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to save the post.") });
  }
});

router.delete("/posts/:postId", firebaseAuth, moduleGate("blog"), async (req, res): Promise<void> => {
  const params = DeletePostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid post." });
    return;
  }
  try {
    const who = await pastor(req, res);
    if (!who) return;
    const post = await ownPost(params.data.postId, who.context.churchId, who.user.uid);
    if (!post) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    await post.ref.delete();
    await audit(who.context.churchId, who.user.uid, "post_deleted", post.ref.id);
    res.sendStatus(204);
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to delete the post.") });
  }
});

/* ------------------------------------------------------------ Public pages ---- */

/** The church behind a public blog address, if it is active and has the blog on. */
async function publicBlogChurch(slug: string) {
  const { db } = getFirebaseServices();
  const result = await db.collection("churches").where("slug", "==", slug).where("status", "==", "active").limit(1).get();
  if (result.empty) return null;
  const church = result.docs[0];
  if (!(await isModuleActive(church.id, "blog"))) return null;
  const settings = await db.collection("churchSettings").doc(church.id).get();
  return {
    id: church.id,
    info: {
      name: String(church.get("name") ?? ""),
      slug: String(church.get("slug") ?? slug),
      careEnabled: settings.get("publicPortalEnabled") !== false,
    },
  };
}

router.get("/public/churches/:slug/posts", async (req, res): Promise<void> => {
  const params = GetPublicBlogParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "This blog is not available." });
    return;
  }
  try {
    const church = await publicBlogChurch(params.data.slug);
    if (!church) {
      res.status(404).json({ error: "This blog is not available." });
      return;
    }
    const snap = await getFirebaseServices()
      .db.collection(POSTS)
      .where("churchId", "==", church.id)
      .where("status", "==", "published")
      .limit(500)
      .get();
    const posts = snap.docs
      .map((doc) => publicSummary(doc.id, doc.data()))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    res.set("Cache-Control", "public, max-age=60");
    res.json(GetPublicBlogResponse.parse({ church: church.info, posts }));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(500).json({ error: "The blog could not be loaded. Please try again later." });
  }
});

router.get("/public/churches/:slug/posts/:postId", async (req, res): Promise<void> => {
  const params = GetPublicPostParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "This post is not available." });
    return;
  }
  try {
    const church = await publicBlogChurch(params.data.slug);
    const snap = church
      ? await getFirebaseServices().db.collection(POSTS).doc(params.data.postId).get()
      : null;
    if (!church || !snap?.exists || snap.get("churchId") !== church.id || snap.get("status") !== "published") {
      res.status(404).json({ error: "This post is not available." });
      return;
    }
    const data = snap.data() ?? {};
    res.set("Cache-Control", "public, max-age=60");
    res.json(
      GetPublicPostResponse.parse({
        church: church.info,
        post: { ...publicSummary(snap.id, data), body: toSafeHtml(data.body) },
      }),
    );
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(500).json({ error: "The post could not be loaded. Please try again later." });
  }
});

export default router;
