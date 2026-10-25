import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getListChurchModulesQueryKey,
  useListChurchModules,
  useSuggestModule,
  useUpdateChurchModule,
  type ChurchModule,
} from "@workspace/api-client-react";
import { Check, Puzzle, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button, EmptyState, ErrorPanel, Field, MutationError, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { roleLabel } from "@/components/workspace-layout";
import { apiErrorMessage } from "@/firebase-auth";

const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  church: "Church",
  plus: "Church Plus",
  addon: "Add-on",
};

function whoUsesIt(module: ChurchModule) {
  return module.roles.length ? `For ${module.roles.map((r) => roleLabel(r).toLowerCase()).join(", ")}` : "";
}

/** Pastors and the workspace admin choose which optional modules their church uses. */
export function ModulesPage() {
  const list = useListChurchModules({ query: { queryKey: getListChurchModulesQueryKey(), retry: 1 } });
  const update = useUpdateChurchModule();
  const suggest = useSuggestModule();
  const qc = useQueryClient();
  const [idea, setIdea] = useState("");
  const [thanks, setThanks] = useState(false);

  const change = (moduleId: string, data: { enabled?: boolean; interested?: boolean }) =>
    update.mutate(
      { moduleId, data },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListChurchModulesQueryKey() });
          // The menu follows the session's list of active modules.
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        },
      },
    );

  const sendIdea = (e: FormEvent) => {
    e.preventDefault();
    suggest.mutate(
      { data: { text: idea.trim() } },
      {
        onSuccess: () => {
          setIdea("");
          setThanks(true);
        },
      },
    );
  };

  const available = list.data?.modules.filter((m) => m.status === "available" || m.status === "beta") ?? [];
  const upcoming = list.data?.modules.filter((m) => m.status === "coming_soon") ?? [];

  return (
    <>
      <PageHeading
        eyebrow="Make Pastora yours"
        title="Modules"
        subtitle="Add what your church needs and leave out what it doesn't. Switching a module off hides it; nothing is deleted."
      />
      {list.data && (
        <div className="care-private-banner">
          <Sparkles size={17} />
          <span>
            {list.data.earlyAccess
              ? "Early access: every available module is included for your church at no cost."
              : `Your church is on the ${PLAN_NAMES[list.data.plan]} plan. Modules outside your plan can be added by Pastora.`}
          </span>
        </div>
      )}
      <MutationError errors={[update.error]} />
      {list.isLoading ? (
        <SkeletonRows />
      ) : list.isError ? (
        <ErrorPanel text={apiErrorMessage(list.error, "Modules are unavailable.")} retry={() => void list.refetch()} />
      ) : (
        <>
          <h2 className="serif section-title">Available</h2>
          {available.length ? (
            <div className="module-grid">
              {available.map((m) => (
                <article className={`module-card ${m.active ? "on" : ""}`} key={m.id}>
                  <div className="module-head">
                    <span className="module-icon">
                      <Puzzle size={16} />
                    </span>
                    <div>
                      <h3>{m.name}</h3>
                      <small>
                        {whoUsesIt(m)}
                        {m.status === "beta" ? " · Beta" : ""}
                      </small>
                    </div>
                  </div>
                  <p>{m.description}</p>
                  <div className="module-foot">
                    {m.entitled ? (
                      <div className="toggle-row">
                        <span>{m.enabled ? "On for your church" : "Off"}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={m.enabled}
                          aria-label={`${m.name}: ${m.enabled ? "on" : "off"}`}
                          className={`switch ${m.enabled ? "on" : ""}`}
                          disabled={update.isPending}
                          onClick={() => change(m.id, { enabled: !m.enabled })}
                        >
                          <i />
                        </button>
                      </div>
                    ) : (
                      <span className="module-plan">
                        {m.plan === "addon" ? "Add-on" : `In the ${PLAN_NAMES[m.plan]} plan`}
                        {m.priceNote ? ` · ${m.priceNote}` : ""} · <a href="/support">Ask Pastora</a>
                      </span>
                    )}
                    {m.granted && <span className="module-plan">Given free by Pastora</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No modules yet" description="New modules will appear here as they become available." />
          )}

          {upcoming.length > 0 && (
            <>
              <h2 className="serif section-title">Coming soon</h2>
              <p className="role-help">
                Tell us which of these your church would use. The modules churches ask for most are built first.
              </p>
              <div className="module-grid">
                {upcoming.map((m) => (
                  <article className="module-card upcoming" key={m.id}>
                    <div className="module-head">
                      <span className="module-icon">
                        <Puzzle size={16} />
                      </span>
                      <div>
                        <h3>{m.name}</h3>
                        <small>
                          {whoUsesIt(m)}
                          {m.plan === "addon" ? " · Add-on" : ` · ${PLAN_NAMES[m.plan]} plan`}
                          {m.priceNote ? ` · ${m.priceNote}` : ""}
                        </small>
                      </div>
                    </div>
                    <p>{m.description}</p>
                    <div className="module-foot">
                      <Button
                        variant={m.interested ? "primary" : "outline"}
                        disabled={update.isPending}
                        onClick={() => change(m.id, { interested: !m.interested })}
                      >
                        {m.interested ? (
                          <>
                            <Check size={15} /> We'd use this
                          </>
                        ) : (
                          "We'd use this"
                        )}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          <h2 className="serif section-title">Suggest a module</h2>
          <form className="inline-form module-suggest" onSubmit={sendIdea}>
            <Field label="What would make your church's work easier?">
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={idea}
                placeholder="For example: a rota for ushers and greeters, with reminders the day before."
                onChange={(e) => {
                  setIdea(e.target.value);
                  setThanks(false);
                }}
              />
            </Field>
            <div className="form-actions">
              <Button type="submit" disabled={suggest.isPending}>
                {suggest.isPending ? "Sending…" : "Send suggestion"}
              </Button>
              {thanks && <span className="inline-success">Thank you. We read every suggestion.</span>}
            </div>
            <MutationError errors={[suggest.error]} />
          </form>
        </>
      )}
    </>
  );
}
