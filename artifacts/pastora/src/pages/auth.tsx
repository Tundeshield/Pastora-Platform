import {
  createUserWithEmailAndPassword,
  firebaseAuth,
  isFirebaseClientConfigured,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "@/firebase-auth";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getGetSetupStatusQueryKey,
  useGetSetupStatus,
} from "@workspace/api-client-react";
import { ArrowRight, CircleHelp, HeartHandshake } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";

import { Button, Field, Footer, Header, StatusLine } from "@/components/ui-kit";

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" | "forgot" | "verify" }) {
  const setup = useGetSetupStatus({ query: { queryKey: getGetSetupStatusQueryKey(), retry: 1 } });
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = {
    "sign-in": ["Welcome back", "Sign in to your church workspace."],
    "sign-up": ["A workspace for your church", "Start by creating your account."],
    forgot: [
      "Recover your account",
      "Password recovery will be available once account services are configured.",
    ],
    verify: ["Check your email", "Email verification is available after account services are configured."],
  }[mode];
  const unavailable =
    setup.isError || !setup.data?.firebaseConfigured || !isFirebaseClientConfigured || !firebaseAuth;
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (!firebaseAuth) throw new Error("Firebase Auth is not configured in this frontend.");
      if (mode === "sign-in") {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
        await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        setLocation(credential.user.emailVerified ? "/app" : "/verify-email");
      } else if (mode === "sign-up") {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        await sendEmailVerification(credential.user);
        setLocation("/verify-email");
      } else if (mode === "forgot") {
        await sendPasswordResetEmail(firebaseAuth, email);
        setMessage("If the address is registered, a recovery email has been sent.");
      } else if (mode === "verify" && firebaseAuth.currentUser) {
        await sendEmailVerification(firebaseAuth.currentUser);
        setMessage("Verification email sent. Follow the link in your inbox, then sign in again.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The account action could not be completed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-shell grain">
      <Header />
      <main className="auth-main">
        <div className="auth-aside">
          <span className="eyebrow">Pastora / Account</span>
          <h1 className="serif">
            A quieter place
            <br />
            to <em>keep caring.</em>
          </h1>
          <p>Your church workspace is waiting for the right account setup.</p>
          <div className="auth-aside-mark">
            <HeartHandshake size={28} />
          </div>
        </div>
        <section className="auth-card">
          <Link href="/" className="back-link">
            ← Back to Pastora
          </Link>
          <p className="eyebrow">{mode === "sign-up" ? "Create account" : "Your account"}</p>
          <h2 className="serif">{copy[0]}</h2>
          <p>{copy[1]}</p>
          {unavailable ? (
            <div className="setup-callout">
              <CircleHelp />
              <div>
                <b>{setup.isLoading ? "Checking account configuration" : "Account services need setup"}</b>
                <span>
                  {setup.isLoading
                    ? "Checking Firebase readiness…"
                    : !setup.data?.firebaseConfigured
                      ? "Firebase is not configured on the service. No account action has been performed."
                      : "Firebase client configuration is missing from this frontend. Add VITE_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID and APP_ID."}
                </span>
              </div>
            </div>
          ) : mode === "verify" && !firebaseAuth?.currentUser ? (
            <div className="setup-callout">
              <CircleHelp />
              <div>
                <b>Verification needs your account</b>
                <span>Sign in with the email you registered to request a verification link.</span>
              </div>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              {mode !== "verify" && (
                <Field label="Email address">
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
              )}
              {(mode === "sign-in" || mode === "sign-up") && (
                <Field label="Password">
                  <input
                    required
                    type="password"
                    minLength={6}
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "sign-in"
                    ? "Sign in"
                    : mode === "sign-up"
                      ? "Create account"
                      : mode === "forgot"
                        ? "Send recovery email"
                        : "Send verification email"}{" "}
                <ArrowRight size={15} />
              </Button>
            </form>
          )}
          {message && <StatusLine>{message}</StatusLine>}
          {error && <StatusLine error>{error}</StatusLine>}
          <div className="auth-links">
            {mode !== "sign-in" && <Link href="/sign-in">Sign in</Link>}
            {mode !== "sign-up" && <Link href="/sign-up">Create account</Link>}
            {mode !== "forgot" && <Link href="/forgot-password">Forgot password?</Link>}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
