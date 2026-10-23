import { ApiRequestError, setAuthTokenGetter } from "@workspace/api-client-react";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

// Firebase web config values are public identifiers (they ship to every browser).
// What protects data is the API's server-side authorisation; see docs/SECURITY.md.
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
export const isFirebaseClientConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

let auth: Auth | null = null;
if (isFirebaseClientConfigured) {
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence);
}
export const firebaseAuth = auth;

/**
 * Resolves once Firebase has restored (or ruled out) a saved session. API calls wait
 * for this so a page refresh never sends an unauthenticated request for a user who
 * is in fact signed in.
 */
export const authReady: Promise<User | null> = new Promise((resolve) => {
  if (!auth) return resolve(null);
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    unsubscribe();
    resolve(user);
  });
});

setAuthTokenGetter(async () => {
  await authReady;
  return (await firebaseAuth?.currentUser?.getIdToken()) ?? null;
});

/** Plain-language messages for Firebase Auth error codes. */
export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "That email and password don't match an account.",
    "auth/wrong-password": "That email and password don't match an account.",
    "auth/user-not-found": "That email and password don't match an account.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use":
      "An account already exists for this email. Sign in instead, or reset your password.",
    "auth/weak-password": "Choose a stronger password of at least 8 characters.",
    "auth/missing-password": "Enter your password.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "We couldn't reach the sign-in service. Check your connection.",
    "auth/user-disabled": "This account has been disabled. Contact your church administrator.",
    "auth/operation-not-allowed": "Email and password sign-in is not enabled for this Firebase project.",
    "auth/unauthorized-domain": "This website address is not authorised for sign-in in Firebase.",
    "auth/user-token-expired": "Your session has expired. Please sign in again.",
    "auth/requires-recent-login": "Please sign in again to continue.",
  };
  if (messages[code]) return messages[code];
  if (error instanceof ApiRequestError) return apiErrorMessage(error);
  return "Something went wrong. Please try again.";
}

/** The server's `{ error }` message, falling back to a friendly default. */
export function apiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof ApiRequestError) {
    const data = error.data as { error?: unknown } | null;
    if (data && typeof data.error === "string" && !data.error.trim().startsWith("[")) return data.error;
    if (error.status === 401) return "Your session has expired. Please sign in again.";
    if (error.status === 403) return "Your role doesn't allow this action.";
    if (error.status === 429) return "Too many requests. Please wait a moment and try again.";
    if (error.status >= 500) return "The service is unavailable right now. Please try again shortly.";
  }
  return fallback;
}

export {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
};
export type { User };
