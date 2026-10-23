import { firebaseAuth, isFirebaseClientConfigured, onAuthStateChanged } from "@/firebase-auth";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getGetSetupStatusQueryKey,
  useCreateWorkspace,
  useGetSetupStatus,
} from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";

import { Button, Field, PublicFrame, StatusLine } from "@/components/ui-kit";

export function OnboardingPage() {
  const ready = useGetSetupStatus({ query: { queryKey: getGetSetupStatusQueryKey(), retry: 1 } });
  const create = useCreateWorkspace();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [userReady, setUserReady] = useState(!!firebaseAuth?.currentUser);
  useEffect(
    () => (firebaseAuth ? onAuthStateChanged(firebaseAuth, (user) => setUserReady(!!user)) : undefined),
    [],
  );
  const [form, setForm] = useState({
    pastorName: "",
    churchName: "",
    country: "",
    timeZone: "UTC",
    theme: "warm-cream" as "warm-cream" | "modern-cool",
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready.data?.firebaseConfigured || !userReady) return;
    create.mutate(
      { data: { ...form } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
          setLocation("/app");
        },
      },
    );
  };
  const canCreate = !!ready.data?.firebaseConfigured && isFirebaseClientConfigured && userReady;
  return (
    <PublicFrame>
      <main className="inner-page onboarding">
        <div className="inner-heading">
          <p className="eyebrow">First, make it yours</p>
          <h1 className="serif">
            A home for
            <br />
            <em>your church.</em>
          </h1>
          <p>Set the foundations for a calm, useful workspace.</p>
        </div>
        <form className="form-card" onSubmit={submit}>
          <Field label="Your name">
            <input
              required
              value={form.pastorName}
              onChange={(e) => setForm({ ...form, pastorName: e.target.value })}
            />
          </Field>
          <Field label="Church name">
            <input
              required
              value={form.churchName}
              onChange={(e) => setForm({ ...form, churchName: e.target.value })}
            />
          </Field>
          <Field label="Country">
            <input
              required
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
          </Field>
          <Field label="Time zone">
            <input
              required
              value={form.timeZone}
              onChange={(e) => setForm({ ...form, timeZone: e.target.value })}
            />
          </Field>
          <Field label="Workspace feel">
            <select
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value as "warm-cream" | "modern-cool" })}
            >
              <option value="warm-cream">Warm Cream</option>
              <option value="modern-cool">Modern Cool</option>
            </select>
          </Field>
          <StatusLine error={!canCreate}>
            {ready.isLoading
              ? "Checking account readiness…"
              : ready.isError
                ? "Could not verify account setup."
                : !ready.data?.firebaseConfigured
                  ? "Firebase configuration is needed before workspace creation."
                  : !isFirebaseClientConfigured
                    ? "Firebase client configuration is missing."
                    : !userReady
                      ? "Sign in before creating a church workspace."
                      : "Account setup is ready."}
          </StatusLine>
          <Button type="submit" disabled={!canCreate || create.isPending}>
            {create.isPending ? "Creating…" : "Create workspace"} <ArrowRight size={15} />
          </Button>
          {!userReady && isFirebaseClientConfigured && (
            <Link className="under-link" href="/sign-in">
              Sign in to continue <ArrowRight size={14} />
            </Link>
          )}
          {create.isError && (
            <StatusLine error>Workspace could not be created. Please try again after setup.</StatusLine>
          )}
        </form>
      </main>
    </PublicFrame>
  );
}
