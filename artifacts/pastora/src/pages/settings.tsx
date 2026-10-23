import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getGetSettingsQueryKey,
  useGetSettings,
  useUpdateSettings,
} from "@workspace/api-client-react";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Button,
  EmptyState,
  ErrorPanel,
  Field,
  MutationError,
  PageHeading,
  SkeletonRows,
  Toggle,
} from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";
import { applyTheme, storedTheme } from "@/theme";

export function SettingsPage() {
  const q = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), retry: 1 } });
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const [local, setLocal] = useState<any>(null);
  useEffect(() => {
    if (q.data && !local)
      setLocal({ ...q.data, theme: q.data.theme === "modern-cool" ? "modern-cool" : "warm-cream" });
  }, [q.data, local]);
  const [themeChoice, setThemeChoice] = useState<string>(storedTheme());
  const [saved, setSaved] = useState(false);
  const save = (payload: Record<string, unknown>) =>
    update.mutate(
      { data: payload },
      {
        onSuccess: (data) => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
          qc.setQueryData(getGetSettingsQueryKey(), data);
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        },
      },
    );
  if (q.isLoading)
    return (
      <>
        <PageHeading
          eyebrow="Make it yours"
          title="Settings"
          subtitle="Church details and workspace preferences."
        />
        <SkeletonRows />
      </>
    );
  if (q.isError)
    return (
      <>
        <PageHeading
          eyebrow="Make it yours"
          title="Settings"
          subtitle="Church details and workspace preferences."
        />
        <ErrorPanel
          text={apiErrorMessage(q.error, "Church settings are unavailable.")}
          retry={() => void q.refetch()}
        />
      </>
    );
  if (!local)
    return (
      <EmptyState
        title="Settings not returned"
        description="No church settings are available for this workspace."
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="Make it yours"
        title="Settings"
        subtitle="Church details, public care and workspace preferences."
      />
      <MutationError errors={[update.error]} />
      {saved && (
        <div className="inline-success" role="status">
          Settings saved.
        </div>
      )}
      <div className="settings-stack">
        <section className="settings-section">
          <div>
            <p className="eyebrow">Church identity</p>
            <h2 className="serif">The essentials</h2>
            <p>Update the details connected to your church workspace.</p>
          </div>
          <div className="settings-fields">
            <Field label="Church name">
              <input
                value={local.church.name}
                onChange={(e) => setLocal({ ...local, church: { ...local.church, name: e.target.value } })}
              />
            </Field>
            <Field label="Country">
              <input
                value={local.church.country}
                onChange={(e) => setLocal({ ...local, church: { ...local.church, country: e.target.value } })}
              />
            </Field>
            <Field label="Time zone">
              <input
                value={local.church.timeZone}
                onChange={(e) =>
                  setLocal({ ...local, church: { ...local.church, timeZone: e.target.value } })
                }
              />
            </Field>
            <Button
              onClick={() =>
                save({
                  name: local.church.name,
                  country: local.church.country,
                  timeZone: local.church.timeZone,
                })
              }
            >
              Save church details
            </Button>
          </div>
        </section>
        <section className="settings-section">
          <div>
            <p className="eyebrow">Public care portal</p>
            <h2 className="serif">A welcoming front door</h2>
            <p>These messages are visible to people reaching out.</p>
          </div>
          <div className="settings-fields">
            <Field label="Welcome message">
              <textarea
                value={local.welcomeMessage}
                onChange={(e) => setLocal({ ...local, welcomeMessage: e.target.value })}
              />
            </Field>
            <Field label="Emergency notice">
              <textarea
                value={local.emergencyNotice}
                onChange={(e) => setLocal({ ...local, emergencyNotice: e.target.value })}
              />
            </Field>
            <Field label="Request categories (comma separated)">
              <input
                value={local.categories.join(", ")}
                onChange={(e) =>
                  setLocal({
                    ...local,
                    categories: e.target.value
                      .split(",")
                      .map((s: string) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Toggle
              label="Enable public care portal"
              value={local.publicPortalEnabled}
              onChange={(v) => setLocal({ ...local, publicPortalEnabled: v })}
            />
            <Toggle
              label="Allow appointment requests"
              value={local.appointmentEnabled}
              onChange={(v) => setLocal({ ...local, appointmentEnabled: v })}
            />
            <Button
              onClick={() =>
                save({
                  welcomeMessage: local.welcomeMessage,
                  emergencyNotice: local.emergencyNotice,
                  categories: local.categories,
                  publicPortalEnabled: local.publicPortalEnabled,
                  appointmentEnabled: local.appointmentEnabled,
                })
              }
            >
              Save portal settings
            </Button>
          </div>
        </section>
        <section className="settings-section">
          <div>
            <p className="eyebrow">Workspace feel</p>
            <h2 className="serif">Choose your palette</h2>
            <p>Applies to everyone in this workspace and follows you to any device.</p>
          </div>
          <div className="theme-options">
            <button
              className={`theme-option cream-option ${themeChoice === "warm-cream" ? "selected" : ""}`}
              onClick={() => {
                setThemeChoice("warm-cream");
                applyTheme("warm-cream");
                save({ theme: "warm-cream" });
              }}
            >
              <Sun />
              <b>Warm Cream</b>
              <small>Soft parchment, leaf green, muted terracotta</small>
            </button>
            <button
              className={`theme-option cool-option ${themeChoice === "modern-cool" ? "selected" : ""}`}
              onClick={() => {
                setThemeChoice("modern-cool");
                applyTheme("modern-cool");
                save({ theme: "modern-cool" });
              }}
            >
              <Moon />
              <b>Modern Cool</b>
              <small>Quiet slate, mineral blue, cool sage</small>
            </button>
          </div>
        </section>
        <section className="settings-section">
          <div>
            <p className="eyebrow">Privacy</p>
            <h2 className="serif">Retention preference</h2>
            <p>Choose how long records are retained where supported.</p>
          </div>
          <div className="settings-fields">
            <Field label="Retention days">
              <input
                type="number"
                min="0"
                value={local.retentionDays}
                onChange={(e) => setLocal({ ...local, retentionDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Default appointment length (minutes)">
              <input
                type="number"
                min="15"
                max="240"
                value={local.appointmentDurationMinutes}
                onChange={(e) => setLocal({ ...local, appointmentDurationMinutes: Number(e.target.value) })}
              />
            </Field>
            <Button
              onClick={() =>
                save({
                  retentionDays: local.retentionDays,
                  appointmentDurationMinutes: local.appointmentDurationMinutes,
                })
              }
            >
              Save privacy settings
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
