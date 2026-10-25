/**
 * Church web addresses.
 *
 * With VITE_PUBLIC_BASE_DOMAIN set (e.g. "getpastora.app"), each church has its own
 * address: https://<church-address>.getpastora.app shows its care page, and /blog its
 * blog. Pastora itself (website and workspace) lives on the main host, by default
 * www.<base domain> (override with VITE_APP_ORIGIN).
 *
 * Without it (today, on pastora-platform.netlify.app) everything uses paths:
 * /care/<church-address> and /blog/<church-address>. Those paths keep working on the
 * main host forever, so links and QR codes printed earlier never break.
 */

const BASE_DOMAIN = ((import.meta.env.VITE_PUBLIC_BASE_DOMAIN as string | undefined) ?? "").trim().toLowerCase();

/** Words a church address can never be, because Pastora uses them as host names. */
export const RESERVED_ADDRESSES = new Set([
  "www", "app", "api", "admin", "mail", "email", "help", "support", "status", "blog", "docs",
  "staging", "dev", "test", "beta", "demo", "ftp", "smtp", "ns1", "ns2", "cdn", "static", "assets",
]);

export const churchAddressesEnabled = Boolean(BASE_DOMAIN);

function portSuffix(): string {
  // Only matters for local testing (e.g. grace.localhost:5173).
  return window.location.port ? `:${window.location.port}` : "";
}

/** The church address this page is being shown on (e.g. "redeemed-lekki"), if any. */
export function churchFromHost(hostname = window.location.hostname): string | null {
  if (!BASE_DOMAIN) return null;
  const host = hostname.toLowerCase();
  if (!host.endsWith(`.${BASE_DOMAIN}`)) return null;
  const label = host.slice(0, -(BASE_DOMAIN.length + 1));
  if (!label || label.includes(".") || RESERVED_ADDRESSES.has(label)) return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? label : null;
}

/** Where Pastora's own website and workspace live. */
export function mainOrigin(): string {
  const configured = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.replace(/\/$/, "");
  if (configured) return configured;
  if (BASE_DOMAIN && churchFromHost()) return `${window.location.protocol}//www.${BASE_DOMAIN}${portSuffix()}`;
  return window.location.origin;
}

/** A full link to Pastora's main site, e.g. mainUrl("/sign-in"). */
export function mainUrl(path = "/"): string {
  return `${mainOrigin()}${path}`;
}

type ChurchPage = { page: "care" } | { page: "blog" } | { page: "post"; postId: string };

function churchPath(slug: string, target: ChurchPage, onChurchHost: boolean): string {
  if (onChurchHost) {
    if (target.page === "care") return "/";
    if (target.page === "blog") return "/blog";
    return `/blog/${target.postId}`;
  }
  if (target.page === "care") return `/care/${slug}`;
  if (target.page === "blog") return `/blog/${slug}`;
  return `/blog/${slug}/${target.postId}`;
}

/** A full, shareable link to a church page (its own address when configured). */
export function churchUrl(slug: string, target: ChurchPage = { page: "care" }): string {
  if (BASE_DOMAIN) {
    return `${window.location.protocol}//${slug}.${BASE_DOMAIN}${portSuffix()}${churchPath(slug, target, true)}`;
  }
  return `${window.location.origin}${churchPath(slug, target, false)}`;
}

/**
 * A link between pages of the same church site. On the church's own address it is a
 * short path ("/blog"); on the main host it is the path form ("/blog/<church>").
 */
export function churchLink(slug: string, target: ChurchPage): string {
  return churchPath(slug, target, churchFromHost() === slug);
}
