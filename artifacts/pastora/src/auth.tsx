import { PastoraMark } from "@/components/logo";
import { firebaseAuth, onAuthStateChanged, reload, signOut, type User } from "@/firebase-auth";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiRequestError,
  getGetSessionQueryKey,
  useGetSession,
  type Session,
} from "@workspace/api-client-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

type AuthState = {
  status: "loading" | "signed-out" | "signed-in";
  user: User | null;
  signOutUser: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(firebaseAuth?.currentUser ?? null);
  const [status, setStatus] = useState<AuthState["status"]>(firebaseAuth ? "loading" : "signed-out");
  // undefined = Firebase hasn't reported yet; null = signed out.
  const lastUid = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!firebaseAuth) return;
    const unsubscribe = onAuthStateChanged(firebaseAuth, (next) => {
      // Never let one account see another account's cached data. resetQueries (not
      // clear) drops cached data but keeps mounted queries alive and refetches them;
      // clear() orphaned in-flight requests and left pages loading forever. The first
      // report after page load is not an account switch, so nothing is reset then.
      const uid = next?.uid ?? null;
      if (lastUid.current !== undefined && uid !== lastUid.current) void queryClient.resetQueries();
      lastUid.current = uid;
      setUser(next);
      setStatus(next ? "signed-in" : "signed-out");
    });
    return unsubscribe;
  }, [queryClient]);

  const signOutUser = useCallback(async () => {
    if (firebaseAuth) await signOut(firebaseAuth);
    queryClient.removeQueries({ queryKey: getGetSessionQueryKey() });
    void queryClient.resetQueries();
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    const current = firebaseAuth?.currentUser ?? null;
    if (!current) return null;
    await reload(current);
    await current.getIdToken(true); // pick up email_verified in the server token
    setUser(firebaseAuth?.currentUser ?? null);
    await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
    return firebaseAuth?.currentUser ?? null;
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ status, user, signOutUser, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** The API session for the signed-in user (disabled until Firebase has a user). */
export function useSession() {
  const { status } = useAuth();
  return useGetSession({
    query: {
      queryKey: getGetSessionQueryKey(),
      enabled: status === "signed-in",
      retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
      staleTime: 30_000,
    },
  });
}

/** Where a signed-in user should land, given their session. */
export function destinationFor(session: Session | undefined, user: User | null): string {
  if (!session) return "/app";
  if (session.church) return "/app";
  if (!user?.emailVerified || !session.emailVerified) return "/verify-email";
  return "/onboarding";
}

export function safeNext(next: string | null): string | null {
  return next && (next.startsWith("/app") || next === "/admin") && !next.startsWith("//") ? next : null;
}

export function FullPageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="full-page-message" role="status" aria-live="polite">
      <PastoraMark size={38} className="pulse" />
      <p className="serif">{title}</p>
      {children}
    </div>
  );
}

/**
 * Guards workspace pages: waits for Firebase to restore the session, sends signed-out
 * visitors to sign-in (remembering where they were going), unverified users to email
 * verification, and users without a church to onboarding.
 */
export function RequireWorkspace({ children }: { children: ReactNode }) {
  const { status, user, signOutUser } = useAuth();
  const session = useSession();
  const [location, setLocation] = useLocation();

  const unauthorised = session.error instanceof ApiRequestError && session.error.status === 401;
  useEffect(() => {
    if (status === "signed-out") {
      setLocation(`/sign-in?next=${encodeURIComponent(location)}`, { replace: true });
    } else if (unauthorised) {
      void signOutUser().then(() => setLocation("/sign-in?expired=1", { replace: true }));
    } else if (session.data && !session.data.church) {
      setLocation(destinationFor(session.data, user), { replace: true });
    }
  }, [status, unauthorised, session.data, user, location, setLocation, signOutUser]);

  if (status === "loading" || (status === "signed-in" && session.isLoading)) {
    return <FullPageMessage title="Opening your workspace…" />;
  }
  if (status === "signed-out" || unauthorised || (session.data && !session.data.church)) {
    return <FullPageMessage title="Redirecting…" />;
  }
  if (session.data?.churchSuspended) {
    return (
      <FullPageMessage title="This workspace has been paused.">
        <p>Your church's Pastora workspace is paused for now. Please contact Pastora support.</p>
        <button className="button outline" onClick={() => void signOutUser()}>
          Sign out
        </button>
      </FullPageMessage>
    );
  }
  if (session.isError) {
    return (
      <FullPageMessage title="We couldn't load your workspace.">
        <p>Check your connection and try again.</p>
        <button className="button primary" onClick={() => void session.refetch()}>
          Try again
        </button>
      </FullPageMessage>
    );
  }
  return <>{children}</>;
}
