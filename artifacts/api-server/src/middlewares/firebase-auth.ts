import type { DecodedIdToken } from "firebase-admin/auth";
import type { Request, Response, NextFunction } from "express";
import {
  FirebaseSetupRequiredError,
  getFirebaseServices,
} from "../lib/firebase-admin";

declare global {
  namespace Express {
    interface Request {
      pastoraUser?: DecodedIdToken;
    }
  }
}

export async function firebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { auth } = getFirebaseServices();
    const authorization = req.get("authorization") ?? "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    req.pastoraUser = await auth.verifyIdToken(token);
    next();
  } catch (error) {
    if (error instanceof FirebaseSetupRequiredError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(401).json({ error: "Your session is invalid or expired." });
  }
}
