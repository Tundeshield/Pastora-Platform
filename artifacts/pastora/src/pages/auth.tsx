import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getGetSetupStatusQueryKey,
  getSession,
  useGetSetupStatus,
} from "@workspace/api-client-react";
import { ArrowRight, CircleHelp, HeartHandshake } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { destinationFor, FullPageMessage, safeNext, useAuth, useSession } from "@/auth";
import { Button, Field, Footer, Header, StatusLine } from "@/components/ui-kit";
import {
  authErrorMessage,
  createUserWithEmailAndPassword,
  firebaseAuth,
  isFirebaseClientConfigured,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "@/firebase-auth";

type Mode = "sign-in" | "sign-up" | "forgot" | "verify";

const COPY: Record<Mode, [string, string]> = {
  "sign-in": ["Welcome back", "Sign in to your church workspace."],
  "sign-up": ["A workspace for your church", "Start by creating your account."],
  forgot: ["Recover your account", "Enter your email and we'll send a link to choose a new password."],
  verify: ["Check your email", "Confirm your address to keep pastoral information safe."],
};

export function AuthPage({ mode }: { mode: Mode }) {
  const setup = useGetSetupStatus({ query: { queryKey: getGetSetupStatusQueryKey(), retry: 1 } });
  const { status, user, signOutUser, refreshUser } = useAuth();
  const session = useSession();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(useSearch());
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(
    params.get("expired") ? "Your session ended. Please sign in again." : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in? Skip the sign-in and sign-up forms.
  useEffect(() => {
    if ((mode === "sign-in" || mode === "sign-up") && status === "signed-in" && session.data && !busy) {
      setLocation(session.data.church ? (next ?? "/app") : destinationFor(session.data, user), {
        replace: true,
      });
    }
  }, [mode, status, session.data, user, busy, next, setLocation]);

  const serviceUnavailable = !isFirebaseClientConfigured || !firebaseAuth;
  const backendUnavailable = setup.data?.firebaseConfigured === false;

  async function routeAfterSignIn() {
    const fresh = await queryClient.fetchQuery({
      queryKey: getGetSessionQueryKey(),
      queryFn: () => getSession(),
    });
    setLocation(fresh.church ? (next ?? "/app") : destinationFor(fresh, firebaseAuth?.currentUser ?? null));
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!firebaseAuth) return;
    setBusy(true);
    try {
      if (mode === "sign-in") {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
        await routeAfterSignIn();
      } else if (mode === "sign-up") {
        if (password.length < 8) throw Object.assign(new Error(), { code: "auth/weak-password" });
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        await sendEmailVerification(credential.user);
        setLocation("/verify-email");
      } else if (mode === "forgot") {
        await sendPasswordResetEmail(firebaseAuth, email.trim());
        setMessage(
          "If an account exists for that address, a reset link is on its way. Check your inbox and spam folder.",
        );
      }
    } catch (reason) {
      // Don't reveal whether an address is registered on the reset form.
      if (mode === "forgot" && (reason as { code?: string })?.code === "auth/user-not-found") {
        setMessage("If an account exists for that address, a reset link is on its way.");
      } else {
        setError(authErrorMessage(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!firebaseAuth?.currentUser) return;
    setError("");
    setBusy(true);
    try {
      await sendEmailVerification(firebaseAuth.currentUser);
      setMessage(`We've sent a new link to ${firebaseAuth.currentUser.email}.`);
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const continueAfterVerify = async () => {
    setError("");
    setBusy(true);
    try {
      const refreshed = await refreshUser();
      if (!refreshed?.emailVerified) {
        setError("We haven't seen the confirmation yet. Open the link in the email, then try again.");
        return;
      }
      await routeAfterSignIn();
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "verify" && status === "loading") return <FullPageMessage title="Checking your account…" />;

  const [title, subtitle] = COPY[mode];
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
          <p>Prayer, counselling and church operations, kept private and in one place.</p>
          <div className="auth-aside-mark">
            <HeartHandshake size={28} />
          </div>
        </div>
        <section className="auth-card">
          <Link href="/" className="back-link">
            ← Back to Pastora
          </Link>
          <p className="eyebrow">{mode === "sign-up" ? "Create account" : "Your account"}</p>
          <h2 className="serif">{title}</h2>
          <p>{subtitle}</p>

          {serviceUnavailable || backendUnavailable ? (
            <div className="setup-callout">
              <CircleHelp />
              <div>
                <b>Account services need setup</b>
                <span>
                  {serviceUnavailable
                    ? "This site is missing its Firebase web configuration (VITE_FIREBASE_* variables)."
                    : "The Pastora API has no Firebase server credentials yet. No account action was performed."}
                </span>
              </div>
            </div>
          ) : mode === "verify" ? (
            status !== "signed-in" ? (
              <div className="setup-callout">
                <CircleHelp />
                <div>
                  <b>Sign in to continue</b>
                  <span>Sign in with the email you registered, then confirm your address.</span>
                </div>
              </div>
            ) : (
              <div className="auth-form">
                <p className="verify-note">
                  We sent a confirmation link to <b>{user?.email}</b>. Open it, then come back here.
                  {session.data?.invitationPending &&
                    " Once confirmed, you'll join the church that invited you automatically."}
                </p>
                <Button onClick={() => void continueAfterVerify()} disabled={busy}>
                  {busy ? "Checking…" : "I've confirmed my email"} <ArrowRight size={15} />
                </Button>
                <Button variant="outline" onClick={() => void resendVerification()} disabled={busy}>
                  Send the link again
                </Button>
              </div>
            )
          ) : (
            <form className="auth-form" onSubmit={handleSubmit} noValidate={false}>
              <Field label="Email address">
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {(mode === "sign-in" || mode === "sign-up") && (
                <Field label={mode === "sign-up" ? "Password (at least 8 characters)" : "Password"}>
                  <input
                    required
                    type="password"
                    minLength={mode === "sign-up" ? 8 : undefined}
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
                      : "Send reset link"}{" "}
                <ArrowRight size={15} />
              </Button>
              {mode === "sign-up" && (
                <p className="auth-terms">
                  By creating an account you agree to the <Link href="/terms">Terms of use</Link> and{" "}
                  <Link href="/privacy">Privacy policy</Link>.
                </p>
              )}
            </form>
          )}
          {message && <StatusLine>{message}</StatusLine>}
          {error && <StatusLine error>{error}</StatusLine>}
          <div className="auth-links">
            {mode === "verify" && status === "signed-in" ? (
              <button
                className="plain-link"
                onClick={() => void signOutUser().then(() => setLocation("/sign-in"))}
              >
                Use a different account
              </button>
            ) : (
              <>
                {mode !== "sign-in" && <Link href="/sign-in">Sign in</Link>}
                {mode !== "sign-up" && <Link href="/sign-up">Create account</Link>}
                {mode !== "forgot" && <Link href="/forgot-password">Forgot password?</Link>}
              </>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
