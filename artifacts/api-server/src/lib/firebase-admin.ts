import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

type FirebaseServices = {
  app: App;
  auth: Auth;
  db: Firestore;
};

let cachedServices: FirebaseServices | null = null;

export class FirebaseSetupRequiredError extends Error {
  constructor() {
    super("Firebase is not configured. Complete the Firebase setup before using Pastora data.");
    this.name = "FirebaseSetupRequiredError";
  }
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      (process.env.K_SERVICE && process.env.FIREBASE_CONFIG),
  );
}

export function getFirebaseServices(): FirebaseServices {
  if (!isFirebaseConfigured()) {
    throw new FirebaseSetupRequiredError();
  }
  if (cachedServices) return cachedServices;

  const existing = getApps()[0];
  if (existing) {
    cachedServices = {
      app: existing,
      auth: getAuth(existing),
      db: getFirestore(existing),
    };
    return cachedServices;
  }

  let app: App;
  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawCredentials) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(rawCredentials) as Record<string, unknown>;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
    }
    app = initializeApp({
      credential: cert(credentials as Parameters<typeof cert>[0]),
      projectId:
        typeof credentials.project_id === "string"
          ? credentials.project_id
          : undefined,
    });
  } else {
    app = initializeApp();
  }

  cachedServices = { app, auth: getAuth(app), db: getFirestore(app) };
  return cachedServices;
}
