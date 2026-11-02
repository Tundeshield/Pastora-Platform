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
import { Copy, ExternalLink, HeartHandshake, Landmark, Leaf, Moon, Sun, Trees, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";

import {
  Button,
  ErrorPanel,
  Field,
  MutationError,
  PageHeading,
  SkeletonRows,
  Toggle,
} from "@/components/ui-kit";
import { useAccess } from "@/access";
import { useSession } from "@/auth";
import { apiErrorMessage } from "@/firebase-auth";
import { EmailAlertsSection } from "@/pages/account";
import { QrCodesSection, publicFormUrl } from "@/pages/qr-codes";
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

type Tab = "care" | "email" | "church";

/**
 * Everything you set up once, in three places: your care page (and the QR codes that
 * point to it), the emails you get, and your church's details. Each person sees only
 * the tabs their access covers.
 */
export function SettingsPage() {
  const access = useAccess();
  const [, setLocation] = useLocation();
  const asked = new URLSearchParams(useSearch()).get("tab") as Tab | null;
  const tabs: { id: Tab; label: string }[] = [
    ...(access.can("qr") || access.can("team") ? [{ id: "care" as const, label: "Care page" }] : []),
    { id: "email", label: "Your emails" },
    ...(access.can("team") ? [{ id: "church" as const, label: "Church" }] : []),
  ];
  const tab = tabs.find((t) => t.id === asked)?.id ?? tabs[0].id;
  return (
    <>
      <PageHeading eyebrow="Set up once" title="Settings" subtitle="Your care page, your emails and your church." />
      <div className="admin-tabs settings-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setLocation(`/app/settings?tab=${t.id}`, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-stack">
        {tab === "care" && <CarePageTab canEdit={access.can("team")} />}
        {tab === "email" && <EmailAlertsSection />}
        {tab === "church" && <ChurchTab />}
      </div>
    </>
  );
}

function useChurchSettings(enabled: boolean) {
  const q = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), retry: 1, enabled } });
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const save = (payload: Record<string, unknown>, onDone?: () => void) =>
    update.mutate(
      { data: payload },
      {
        onSuccess: (data) => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
          qc.setQueryData(getGetSettingsQueryKey(), data);
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
          onDone?.();
        },
      },
    );
  return { q, update, save, saved };
}

function Saved({ show }: { show: boolean }) {
  return show ? (
    <div className="inline-success" role="status">
      Saved.
    </div>
  ) : null;
}

function CareLink() {
  const slug = useSession().data?.church?.slug ?? "";
  const [copied, setCopied] = useState(false);
  if (!slug) return null;
  const url = publicFormUrl(slug, "care");
  return (
    <div className="booking-link care-link">
      <HeartHandshake size={18} />
      <div>
        <b>Your care page</b>
        <code>{url}</code>
        <small>Share it anywhere. People can ask for prayer, book time with you, talk in confidence or ask a question.</small>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => window.prompt("Copy this link", url));
        }}
      >
        <Copy size={14} /> {copied ? "Copied" : "Copy"}
      </Button>
      <a className="button quiet" href={url} target="_blank" rel="noreferrer">
        <ExternalLink size={14} /> Open
      </a>
    </div>
  );
}

function CarePageTab({ canEdit }: { canEdit: boolean }) {
  const { q, update, save, saved } = useChurchSettings(canEdit);
  const [local, setLocal] = useState<{
    welcomeMessage: string;
    emergencyNotice: string;
    categories: string;
    publicPortalEnabled: boolean;
  } | null>(null);
  useEffect(() => {
    if (q.data && !local)
      setLocal({
        welcomeMessage: q.data.welcomeMessage,
        emergencyNotice: q.data.emergencyNotice,
        categories: q.data.categories.join(", "),
        publicPortalEnabled: q.data.publicPortalEnabled,
      });
  }, [q.data, local]);
  return (
    <>
      <CareLink />
      {canEdit && (
        <section className="settings-section">
          <div>
            <h2 className="serif">What people see</h2>
            <p>
              The words at the top of your care page. Booking hours are set in{" "}
              <Link href="/app/appointments?tab=availability">Appointments</Link>.
            </p>
          </div>
          <div className="settings-fields">
            {q.isLoading || (!local && !q.isError) ? (
              <SkeletonRows />
            ) : q.isError || !local ? (
              <ErrorPanel text={apiErrorMessage(q.error, "Care page settings are unavailable.")} retry={() => void q.refetch()} />
            ) : (
              <>
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
                <Field label="Topics people can choose (separate with commas)">
                  <input value={local.categories} onChange={(e) => setLocal({ ...local, categories: e.target.value })} />
                </Field>
                <Toggle
                  label="Care page is open to the public"
                  value={local.publicPortalEnabled}
                  onChange={(v) => setLocal({ ...local, publicPortalEnabled: v })}
                />
                <MutationError errors={[update.error]} />
                <Saved show={saved} />
                <Button
                  onClick={() =>
                    save({
                      welcomeMessage: local.welcomeMessage,
                      emergencyNotice: local.emergencyNotice,
                      categories: local.categories
                        .split(",")
                        .map((c) => c.trim())
                        .filter(Boolean),
                      publicPortalEnabled: local.publicPortalEnabled,
                    })
                  }
                >
                  Save
                </Button>
              </>
            )}
          </div>
        </section>
      )}
      <QrCodesSection />
    </>
  );
}

function ChurchTab() {
  const { q, update, save, saved } = useChurchSettings(true);
  const qc = useQueryClient();
  const [local, setLocal] = useState<{ name: string; country: string; timeZone: string } | null>(null);
  useEffect(() => {
    if (q.data && !local) setLocal({ name: q.data.church.name, country: q.data.church.country, timeZone: q.data.church.timeZone });
  }, [q.data, local]);
  const [appearance, setAppearance] = useState<Appearance>(storedAppearance());
  useEffect(() => {
    if (q.data)
      setAppearance({ theme: q.data.theme as Palette, fontFamily: q.data.fontFamily, fontSize: q.data.fontSize });
  }, [q.data]);
  // Each look choice applies at once and saves only that field; a failed save rolls back.
  const choose = (change: Partial<Appearance>) => {
    const previous = appearance;
    setAppearance(applyAppearance({ ...appearance, ...change }));
    update.mutate(
      { data: change },
      {
        onSuccess: (data) => {
          qc.setQueryData(getGetSettingsQueryKey(), data);
          void qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        },
        onError: () => setAppearance(applyAppearance(previous)),
      },
    );
  };
  if (q.isLoading || (!local && !q.isError)) return <SkeletonRows />;
  if (q.isError || !local)
    return <ErrorPanel text={apiErrorMessage(q.error, "Church settings are unavailable.")} retry={() => void q.refetch()} />;
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return (
    <>
      <section className="settings-section">
        <div>
          <h2 className="serif">Your church</h2>
          <p>Appointment times and emails use your church's time zone.</p>
        </div>
        <div className="settings-fields">
          <Field label="Church name">
            <input value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} />
          </Field>
          <Field label="Country">
            <input value={local.country} onChange={(e) => setLocal({ ...local, country: e.target.value })} />
          </Field>
          <Field label="Time zone">
            {zones.length ? (
              <select value={local.timeZone} onChange={(e) => setLocal({ ...local, timeZone: e.target.value })}>
                {!zones.includes(local.timeZone) && <option value={local.timeZone}>{local.timeZone}</option>}
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            ) : (
              <input value={local.timeZone} onChange={(e) => setLocal({ ...local, timeZone: e.target.value })} />
            )}
          </Field>
          <MutationError errors={[update.error]} />
          <Saved show={saved} />
          <Button onClick={() => save({ name: local.name.trim(), country: local.country.trim(), timeZone: local.timeZone })}>
            Save
          </Button>
        </div>
      </section>
      <details className="settings-section settings-more">
        <summary>
          <span>
            <h2 className="serif">Look and feel</h2>
            <p>Colours and text size for everyone in your church.</p>
          </span>
        </summary>
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
      </details>
    </>
  );
}
