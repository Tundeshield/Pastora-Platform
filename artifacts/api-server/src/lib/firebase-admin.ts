import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

type FirebaseServices = {
  app: App;
  auth: Auth;
  db: Firestore;
};

let cachedServices: FirebaseServices | null = null;
let testServices: FirebaseServices | null = null;

export class FirebaseSetupRequiredError extends Error {
  constructor() {
    super("Firebase is not configured. Complete the Firebase setup before using Pastora data.");
    this.name = "FirebaseSetupRequiredError";
  }
}

/**
 * Credentials are read only on the server, from one of:
 *  1. FIREBASE_SERVICE_ACCOUNT_JSON — the whole service-account JSON (Replit, local).
 *  2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY — the three
 *     fields that matter, for hosts with small env-var limits (Netlify Functions).
 *  3. Cloud Functions / Cloud Run ambient credentials (K_SERVICE + FIREBASE_CONFIG).
 *  4. The Firebase Emulator Suite (FIRESTORE_EMULATOR_HOST + a project id).
 */
function splitCredentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  return projectId && clientEmail && privateKey ? { projectId, clientEmail, privateKey } : null;
}

function emulatorProjectId(): string | null {
  if (!process.env.FIRESTORE_EMULATOR_HOST) return null;
  return process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || null;
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    testServices ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      splitCredentials() ||
      emulatorProjectId() ||
      (process.env.K_SERVICE && process.env.FIREBASE_CONFIG),
  );
}

/** Test hook: lets the API test-suite run real routes against an in-memory Firestore. */
export function setFirebaseServicesForTesting(services: FirebaseServices | null): void {
  testServices = services;
}

export function getFirebaseServices(): FirebaseServices {
  if (testServices) return testServices;
  if (!isFirebaseConfigured()) {
    throw new FirebaseSetupRequiredError();
  }
  if (cachedServices) return cachedServices;

  const existing = getApps()[0];
  if (existing) {
    cachedServices = { app: existing, auth: getAuth(existing), db: getFirestore(existing) };
    return cachedServices;
  }

  let app: App;
  const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const split = splitCredentials();
  const emulatorProject = emulatorProjectId();
  if (rawCredentials) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(rawCredentials) as Record<string, unknown>;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
    }
    app = initializeApp({
      credential: cert(credentials as Parameters<typeof cert>[0]),
      projectId: typeof credentials.project_id === "string" ? credentials.project_id : undefined,
    });
  } else if (split) {
    app = initializeApp({ credential: cert(split), projectId: split.projectId });
  } else if (emulatorProject) {
    app = initializeApp({ projectId: emulatorProject });
  } else {
    app = initializeApp();
  }

  cachedServices = { app, auth: getAuth(app), db: getFirestore(app) };
  return cachedServices;
}
