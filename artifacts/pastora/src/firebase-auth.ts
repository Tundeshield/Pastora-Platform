import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import { setAuthTokenGetter } from '@workspace/api-client-react';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
export const isFirebaseClientConfigured = Object.values(config).every(Boolean);
let auth: Auth | null = null;

if (isFirebaseClientConfigured) {
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
}

export const firebaseAuth = auth;
setAuthTokenGetter(() => firebaseAuth?.currentUser?.getIdToken() ?? null);
export { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword };
