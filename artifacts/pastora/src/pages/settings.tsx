import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getGetSettingsQueryKey,
  useGetSettings,
  useUpdateSettings,
  type FontFamily,
  type FontSize,
  type Palette,
} from "@workspace/api-client-react";
import { Landmark, Leaf, Moon, Sun, Trees, type LucideIcon } from "lucide-react";
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
import { applyAppearance, storedAppearance, type Appearance } from "@/theme";

const PALETTE_OPTIONS: {
  value: Palette;
  label: string;
  description: string;
  className: string;
  icon: LucideIcon;
}[] = [
  {
    value: "warm-cream",
    label: "Warm Cream",
    description: "Soft parchment, leaf green, muted terracotta",
    className: "cream-option",
    icon: Sun,
  },
  {
    value: "modern-cool",
    label: "Modern Cool",
    description: "Quiet slate, mineral blue, cool sage",
    className: "cool-option",
    icon: Moon,
  },
  {
    value: "sage",
    label: "Sage",
    description: "Soft sage green, warm ivory, deep forest text",
    className: "sage-option",
    icon: Leaf,
  },
  {
    value: "heritage-blue",
    label: "Heritage Blue",
    description: "Muted navy, pale blue-grey, antique gold",
    className: "heritage-option",
    icon: Landmark,
  },
  {
    value: "forest-dark",
    label: "Forest Dark",
    description: "Deep forest, elevated dark surfaces, warm gold",
    className: "forest-option",
    icon: Trees,
  },
];

const FONT_OPTIONS: { value: FontFamily; label: string; stack: string }[] = [
  { value: "inter", label: "Inter", stack: "'Inter', sans-serif" },
  { value: "manrope", label: "Manrope", stack: "'Manrope', sans-serif" },
  { value: "roboto", label: "Roboto", stack: "'Roboto', sans-serif" },
  { value: "lora", label: "Lora", stack: "'Lora', Georgia, serif" },
];

const SIZE_OPTIONS: { value: FontSize; label: string; preview: string }[] = [
  { value: "small", label: "Small", preview: "13px" },
  { value: "normal", label: "Normal", preview: "16px" },
  { value: "large", label: "Large", preview: "19px" },
];

export function SettingsPage() {
  const q = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), retry: 1 } });
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const [local, setLocal] = useState<any>(null);
  useEffect(() => {
    if (q.data && !local) setLocal({ ...q.data });
  }, [q.data, local]);
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance());
  useEffect(() => {
    if (q.data) {
      setAppearance({
        theme: q.data.theme as Palette,
        fontFamily: q.data.fontFamily,
        fontSize: q.data.fontSize,
      });
    }
  }, [q.data]);
  // Each choice applies immediately and saves only that one field, so changing the
  // font never overwrites the palette (or vice versa). A failed save is rolled back.
  const choose = (change: Partial<Appearance>) => {
    const previous = appearance;
    const next = applyAppearance({ ...appearance, ...change });
    setAppearance(next);
    update.mutate(
      { data: change },
      {
        onSuccess: (data) => {
          qc.setQueryData(getGetSettingsQueryKey(), data);
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        },
        onError: () => setAppearance(applyAppearance(previous)),
      },
    );
  };
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
            <p className="settings-note">
              Booking hours and online appointments are set in <Link href="/app/appointments">Appointments → Availability</Link>.
            </p>
            <Button
              onClick={() =>
                save({
                  welcomeMessage: local.welcomeMessage,
                  emergencyNotice: local.emergencyNotice,
                  categories: local.categories,
                  publicPortalEnabled: local.publicPortalEnabled,
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
          <div className="workspace-feel">
            <div className="theme-options">
              {PALETTE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={appearance.theme === option.value}
                  className={`theme-option ${option.className} ${appearance.theme === option.value ? "selected" : ""}`}
                  onClick={() => choose({ theme: option.value })}
                >
                  <option.icon />
                  <b>{option.label}</b>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
            <div className="typography-settings">
              <h3>Typography</h3>
              <p>The font and text size used across the workspace for everyone in your church.</p>
              <div className="option-group" role="radiogroup" aria-label="Font">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={appearance.fontFamily === option.value}
                    className={`choice-chip ${appearance.fontFamily === option.value ? "selected" : ""}`}
                    style={{ fontFamily: option.stack }}
                    onClick={() => choose({ fontFamily: option.value })}
                  >
                    {option.label}
                    {option.value === "inter" && <small>Default</small>}
                  </button>
                ))}
              </div>
              <div className="option-group" role="radiogroup" aria-label="Text size">
                {SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={appearance.fontSize === option.value}
                    className={`choice-chip size-chip ${appearance.fontSize === option.value ? "selected" : ""}`}
                    onClick={() => choose({ fontSize: option.value })}
                  >
                    <span style={{ fontSize: option.preview }}>Aa</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
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
            <Button
              onClick={() =>
                save({
                  retentionDays: local.retentionDays,
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
