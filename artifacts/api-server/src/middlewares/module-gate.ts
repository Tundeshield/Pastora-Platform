import type { NextFunction, Request, Response } from "express";
import { failFirebaseSetup, tenantFor } from "../lib/pastora-data";
import { requireModule } from "../lib/modules";

/**
 * Closes a module's routes for churches that don't have it switched on (or aren't
 * entitled to it). Runs after firebaseAuth; requests without a church fall through to
 * the route, which answers with its usual onboarding message.
 */
export function moduleGate(moduleId: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = await tenantFor(req);
      if (context) await requireModule(context.churchId, moduleId);
      next();
    } catch (error) {
      if (failFirebaseSetup(res, error)) return;
      res.status(400).json({ error: "Unable to check this module." });
    }
  };
}
