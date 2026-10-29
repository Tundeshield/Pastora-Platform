import { Router, type IRouter, type Request, type Response } from "express";
import {
  ListChurchModulesResponse,
  SuggestModuleBody,
  UpdateChurchModuleBody,
  UpdateChurchModuleParams,
  UpdateChurchModuleResponse,
} from "@workspace/api-zod";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth } from "../middlewares/firebase-auth";
import {
  audit,
  authenticatedUser,
  errorMessage,
  failFirebaseSetup,
  notifyChurchMembers,
  tenantFor,
  type TenantContext,
} from "../lib/pastora-data";
import { getFirebaseServices } from "../lib/firebase-admin";
import { canManageTeam } from "../lib/policies";
import {
  CHURCH_MODULES,
  MODULE_INTEREST,
  MODULE_SUGGESTIONS,
  churchAccess,
  getPlatformSettings,
  loadCatalog,
  moduleState,
  type ModuleRecord,
} from "../lib/modules";

const router: IRouter = Router();

/** Pastors and the workspace admin choose which modules their church uses. */
async function managerContext(req: Request, res: Response): Promise<TenantContext | null> {
  const context = await tenantFor(req);
  if (!context) {
    res.status(409).json({ error: "Complete church onboarding first." });
    return null;
  }
  if (!canManageTeam(context)) {
    res.status(403).json({ error: "Only pastors and the workspace admin can manage modules." });
    return null;
  }
  // Hidden behind a Pastora Admin feature flag while we keep the app simple.
  if (!(await getPlatformSettings()).modulesVisible) {
    res.status(404).json({ error: "Modules aren't available yet." });
    return null;
  }
  return context;
}

function publicModule(module: ModuleRecord) {
  const { defaultEnabled: _defaultEnabled, ...rest } = module;
  return rest;
}

async function churchModules(churchId: string) {
  const [catalog, settings, access] = await Promise.all([
    loadCatalog(),
    getPlatformSettings(),
    churchAccess(churchId, true),
  ]);
  return {
    plan: access.plan,
    earlyAccess: settings.earlyAccess,
    modulesVisible: settings.modulesVisible,
    // Retired modules disappear for churches; their data stays.
    modules: catalog
      .filter((m) => m.status !== "retired")
      .map((m) => ({ ...publicModule(m), ...moduleState(m, access, settings.earlyAccess, settings.modulesVisible) })),
  };
}

router.get("/modules", firebaseAuth, async (req, res): Promise<void> => {
  try {
    const context = await managerContext(req, res);
    if (!context) return;
    res.json(ListChurchModulesResponse.parse(await churchModules(context.churchId)));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to load modules.") });
  }
});

router.patch("/modules/:moduleId", firebaseAuth, async (req, res): Promise<void> => {
  const params = UpdateChurchModuleParams.safeParse(req.params);
  const body = UpdateChurchModuleBody.safeParse(req.body);
  if (!params.success || !body.success || (body.data.enabled === undefined && body.data.interested === undefined)) {
    res.status(400).json({ error: "Invalid module change." });
    return;
  }
  try {
    const context = await managerContext(req, res);
    const user = authenticatedUser(req);
    if (!context || !user) return;
    const { moduleId } = params.data;
    const current = (await churchModules(context.churchId)).modules.find((m) => m.id === moduleId);
    if (!current) {
      res.status(404).json({ error: "Module not found." });
      return;
    }
    const { db } = getFirebaseServices();

    if (body.data.enabled !== undefined) {
      if (current.status !== "available" && current.status !== "beta") {
        res.status(400).json({ error: `${current.name} isn't available yet.` });
        return;
      }
      if (body.data.enabled && !current.entitled) {
        res.status(403).json({ error: `${current.name} isn't included in your plan. Contact Pastora to add it.` });
        return;
      }
      const ref = db.collection(CHURCH_MODULES).doc(context.churchId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const enabled = { ...((snap.get("enabled") as Record<string, boolean> | undefined) ?? {}) };
        enabled[moduleId] = body.data.enabled!;
        tx.set(ref, { churchId: context.churchId, enabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      await audit(context.churchId, user.uid, body.data.enabled ? "module_enabled" : "module_disabled", moduleId);
      await notifyChurchMembers(
        context.churchId,
        `module_${moduleId}_${Date.now()}`,
        "team",
        `${current.name} was turned ${body.data.enabled ? "on" : "off"}.`,
        "/app/modules",
        (role, permissions) => role === "pastor" || permissions.includes("team"),
      ).catch(() => undefined);
    }

    if (body.data.interested !== undefined) {
      const ref = db.collection(MODULE_INTEREST).doc(`${moduleId}_${context.churchId}`);
      if (body.data.interested) {
        await ref.set({
          moduleId,
          churchId: context.churchId,
          uid: user.uid,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        await ref.delete();
      }
    }

    const updated = (await churchModules(context.churchId)).modules.find((m) => m.id === moduleId);
    res.json(UpdateChurchModuleResponse.parse(updated));
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to update this module.") });
  }
});

router.post("/modules/suggestions", firebaseAuth, async (req, res): Promise<void> => {
  const body = SuggestModuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Tell us a little more about the module you'd like (at least 5 characters)." });
    return;
  }
  try {
    const context = await managerContext(req, res);
    const user = authenticatedUser(req);
    if (!context || !user) return;
    await getFirebaseServices().db.collection(MODULE_SUGGESTIONS).add({
      churchId: context.churchId,
      uid: user.uid,
      email: user.email ?? "",
      text: body.data.text.trim(),
      createdAt: FieldValue.serverTimestamp(),
    });
    res.sendStatus(204);
  } catch (error) {
    if (failFirebaseSetup(res, error)) return;
    res.status(400).json({ error: errorMessage(error, "Unable to send your suggestion.") });
  }
});

export default router;
