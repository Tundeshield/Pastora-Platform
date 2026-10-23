import { useQueryClient } from "@tanstack/react-query";
import { getGetSessionQueryKey, useCreateWorkspace } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";

import { destinationFor, FullPageMessage, useAuth, useSession } from "@/auth";
import { Button, Field, PublicFrame, StatusLine } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";
import { applyAppearance, applyTheme } from "@/theme";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function OnboardingPage() {
  const { status, user } = useAuth();
  const session = useSession();
  const create = useCreateWorkspace();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({
    pastorName: user?.displayName ?? "",
    churchName: "",
    country: "",
    timeZone: browserTimeZone(),
    theme: "warm-cream" as "warm-cream" | "modern-cool",
  });

  // Only verified, signed-in people without a workspace belong here.
  useEffect(() => {
    if (status === "signed-out") setLocation("/sign-in?next=/app", { replace: true });
    else if (session.data && destinationFor(session.data, user) !== "/onboarding") {
      setLocation(destinationFor(session.data, user), { replace: true });
    }
  }, [status, session.data, user, setLocation]);

  if (
    status !== "signed-in" ||
    session.isLoading ||
    (session.data && destinationFor(session.data, user) !== "/onboarding")
  ) {
    return <FullPageMessage title="Preparing your workspace…" />;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { data: { ...form, pastorName: form.pastorName.trim(), churchName: form.churchName.trim() } },
      {
        onSuccess: (created) => {
          qc.setQueryData(getGetSessionQueryKey(), created);
          applyAppearance({ theme: created.theme, fontFamily: created.fontFamily, fontSize: created.fontSize });
          setLocation("/app");
        },
      },
    );
  };

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
          <p>Set the foundations for a calm, useful workspace. You can change these later in Settings.</p>
        </div>
        <form className="form-card" onSubmit={submit}>
          <Field label="Your name">
            <input
              required
              maxLength={120}
              autoComplete="name"
              value={form.pastorName}
              onChange={(e) => setForm({ ...form, pastorName: e.target.value })}
            />
          </Field>
          <Field label="Church name">
            <input
              required
              minLength={2}
              maxLength={160}
              value={form.churchName}
              onChange={(e) => setForm({ ...form, churchName: e.target.value })}
            />
          </Field>
          <Field label="Country">
            <input
              required
              minLength={2}
              maxLength={80}
              autoComplete="country-name"
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
              onChange={(e) => {
                const theme = e.target.value as "warm-cream" | "modern-cool";
                setForm({ ...form, theme });
                applyTheme(theme);
              }}
            >
              <option value="warm-cream">Warm Cream</option>
              <option value="modern-cool">Modern Cool</option>
            </select>
          </Field>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating your workspace…" : "Create workspace"} <ArrowRight size={15} />
          </Button>
          {create.isError && (
            <StatusLine error>
              {apiErrorMessage(create.error, "The workspace could not be created. Please try again.")}
            </StatusLine>
          )}
        </form>
      </main>
    </PublicFrame>
  );
}
