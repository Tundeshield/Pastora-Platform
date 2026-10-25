import { Activity, ArrowRight, CircleHelp, Sparkles } from "lucide-react";
import React, { type ReactNode } from "react";
import { Link as RouterLink } from "wouter";
import { churchFromHost, mainUrl } from "@/site";

import { useAuth } from "@/auth";
import { PastoraMark } from "@/components/logo";
import { apiErrorMessage } from "@/firebase-auth";

/**
 * A link to one of Pastora's own pages. On a church's own address (e.g.
 * grace.getpastora.app) those pages live on the main site, so it becomes a full link.
 */
function Link({ href, ...props }: Omit<React.ComponentProps<"a">, "href"> & { href: string }) {
  if (churchFromHost()) return <a href={mainUrl(href)} {...props} />;
  return <RouterLink href={href} {...props} />;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "quiet" | "outline" | "small";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      data-testid="button-action"
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`button ${variant} ${disabled ? "disabled" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * The logo, wherever it appears (website, care pages, Pastora Admin, workspace):
 * signed-in people go back to their workspace (/app sends each role to its main
 * page), and everyone else to the Pastora homepage.
 */
export function Brand({ compact = false, href }: { compact?: boolean; href?: string }) {
  const { status } = useAuth();
  href ??= status === "signed-in" ? "/app" : "/";
  return (
    <Link
      href={href}
      className="brand"
      data-testid="link-home"
      aria-label={href === "/" ? "Pastora home" : "Workspace home"}
    >
      <PastoraMark size={compact ? 26 : 30} />
      <span>
        pastora<small>{compact ? "" : " care & calling"}</small>
      </span>
    </Link>
  );
}

export function Header({ app = false }: { app?: boolean }) {
  const { status } = useAuth();
  const signedIn = app || status === "signed-in";
  return (
    <header className="topbar">
      <Brand />
      <nav className="main-nav">
        <Link href="/features">Platform</Link>
        <Link href="/pricing">Plans</Link>
        <Link href="/support">Support</Link>
      </nav>
      <div className="header-actions">
        {signedIn ? (
          <Link className="text-link" href="/app">
            Workspace <ArrowRight size={15} />
          </Link>
        ) : (
          <>
            <Link className="sign-in-link" href="/sign-in">
              Sign in
            </Link>
            <Link className="button primary nav-cta" href="/sign-up">
              Create workspace <ArrowRight size={15} />
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <Brand compact />
      <span>Your ministry. A steadier way forward.</span>
      <div>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/support">Support</Link>
      </div>
      <small>© {new Date().getFullYear()} Pastora</small>
    </footer>
  );
}

export function StatusLine({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`status-line ${error ? "error" : ""}`} role="status">
      {error ? <CircleHelp size={16} /> : <Activity size={16} />}
      <span>{children}</span>
    </div>
  );
}

export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell grain">
      <Header />
      {children}
      <Footer />
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="serif">{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`switch ${value ? "on" : ""}`}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </label>
  );
}

export function Badge({ label }: { label: string }) {
  return (
    <span className={`badge badge-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`}>
      {label.replaceAll("_", " ")}
    </span>
  );
}

export function SkeletonRows() {
  return (
    <div className="skeleton-group" aria-label="Loading">
      <i />
      <i />
      <i />
    </div>
  );
}

export function ErrorPanel({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="empty-state error-state">
      <span className="empty-icon">
        <CircleHelp />
      </span>
      <h3>{text}</h3>
      <p>Check the connection and try again.</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Sparkles />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

/** Shows the first server error from a set of mutations, in plain language. */
export function MutationError({ errors }: { errors: unknown[] }) {
  const error = errors.find(Boolean);
  if (!error) return null;
  return (
    <div className="inline-error" role="alert">
      <CircleHelp size={15} />
      <span>{apiErrorMessage(error)}</span>
    </div>
  );
}

const FORMAT_LABELS: Record<string, string> = { "in-person": "In person", phone: "Phone", video: "Video" };

/** "in-person" → "In person" for appointment formats. */
export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? format;
}

/** A date and time without seconds, e.g. "23 Oct 2026, 08:50". */
export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
