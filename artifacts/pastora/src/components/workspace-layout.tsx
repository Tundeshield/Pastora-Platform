import { useQueryClient } from "@tanstack/react-query";
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkNotificationRead,
  type MemberRole,
} from "@workspace/api-client-react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  PenLine,
  QrCode,
  Receipt,
  Puzzle,
  Settings2,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import { RequireWorkspace, useAuth, useSession } from "@/auth";
import { Brand } from "@/components/ui-kit";
import { accessFrom, type Access } from "@/access";
import { applyAppearance } from "@/theme";

/**
 * `show` mirrors the API's access checks so people only see pages they can use;
 * `module` hides the item unless that module is switched on for the church.
 */
type NavItem = { href: string; label: string; icon: LucideIcon; show: (a: Access) => boolean; module?: string };

const anyone = () => true;
const pastors = (a: Access) => a.isPastor;

export const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      {
        href: "/app",
        label: "Overview",
        icon: LayoutDashboard,
        show: (a) => a.can("enquiries") || a.can("calendar") || a.can("prayer"),
      },
      {
        href: "/app/requests",
        label: "Care inbox",
        icon: HeartHandshake,
        show: (a) => a.can("enquiries") || a.can("prayer"),
      },
      { href: "/app/appointments", label: "Appointments", icon: CalendarDays, show: (a) => a.can("calendar") },
      { href: "/app/tasks", label: "Tasks", icon: ClipboardList, show: anyone },
      { href: "/app/messages", label: "Message prep", icon: BookOpen, show: pastors, module: "message-prep" },
      { href: "/app/blog", label: "Blog", icon: PenLine, show: pastors, module: "blog" },
    ],
  },
  {
    label: "Church operations",
    items: [
      { href: "/app/qr-codes", label: "QR links", icon: QrCode, show: (a) => a.can("qr") },
      {
        href: "/app/reports",
        label: "Department reports",
        icon: FileText,
        show: (a) => a.can("reports"),
        module: "reports",
      },
      {
        href: "/app/expenses",
        label: "Expenses",
        icon: Receipt,
        show: (a) => a.can("expenses") || a.can("payments"),
        module: "expenses",
      },
      { href: "/app/team", label: "Team", icon: Users, show: (a) => a.can("team") },
    ],
  },
];

const ROLE_LABELS: Record<MemberRole, string> = {
  pastor: "Pastor",
  staff: "Staff",
  finance: "Finance",
  admin: "Workspace admin",
  prayer_team: "Prayer team",
};

export function roleLabel(role: MemberRole | undefined): string {
  return role ? ROLE_LABELS[role] : "Member";
}

export function pageTitle(path: string) {
  if (path.startsWith("/app/messages/")) return "Message prep";
  if (path.startsWith("/app/blog/")) return "Blog";
  return (
    (
      {
        "/app": "Overview",
        "/app/requests": "Care inbox",
        "/app/appointments": "Appointments",
        "/app/tasks": "Tasks",
        "/app/qr-codes": "QR links",
        "/app/reports": "Department reports",
        "/app/expenses": "Expenses",
        "/app/team": "Team",
        "/app/settings": "Settings",
        "/app/modules": "Modules",
        "/app/messages": "Message prep",
        "/app/blog": "Blog",
      } as Record<string, string>
    )[path] || "Workspace"
  );
}

/** A section stays highlighted on its sub-pages, e.g. a single message. */
function isCurrent(loc: string, href: string) {
  return loc === href || (href !== "/app" && loc.startsWith(`${href}/`));
}

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <RequireWorkspace>
      <WorkspaceShell>{children}</WorkspaceShell>
    </RequireWorkspace>
  );
}

const COLLAPSED_KEY = "pastora-sidebar-collapsed";

function readCollapsed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * The menu: each section folds open or closed (remembered in this browser), the
 * section holding the current page is always open, and a soft fade at the bottom
 * shows when there is more to scroll to.
 */
function SidebarNav({
  sections,
  loc,
  onNavigate,
}: {
  sections: { label: string; items: NavItem[] }[];
  loc: string;
  onNavigate: () => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const [more, setMore] = useState({ above: false, below: false });
  const navRef = useRef<HTMLElement>(null);

  const toggle = (label: string) =>
    setCollapsed((current) => {
      const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // The menu still works; the choice just isn't remembered.
      }
      return next;
    });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () =>
      setMore({
        above: nav.scrollTop > 2,
        below: nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2,
      });
    update();
    nav.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    for (const child of Array.from(nav.children)) observer.observe(child);
    return () => {
      nav.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [sections.length, collapsed]);

  return (
    <nav
      ref={navRef}
      className={`sidebar-nav ${more.above ? "more-above" : ""} ${more.below ? "more-below" : ""}`}
      aria-label="Workspace"
    >
      {sections.map((section) => {
        const holdsCurrent = section.items.some((item) => isCurrent(loc, item.href));
        const open = holdsCurrent || !collapsed.includes(section.label);
        const id = `nav-${section.label.toLowerCase().replace(/\W+/g, "-")}`;
        return (
          <div key={section.label} className="sidebar-section">
            <button
              type="button"
              className="sidebar-label sidebar-toggle"
              aria-expanded={open}
              aria-controls={id}
              disabled={holdsCurrent}
              title={holdsCurrent ? "Contains the page you're on" : open ? "Collapse" : "Expand"}
              onClick={() => toggle(section.label)}
            >
              <span>{section.label}</span>
              {!open && <small>{section.items.length}</small>}
              <ChevronDown size={14} className={open ? "" : "closed"} aria-hidden="true" />
            </button>
            <div id={id} hidden={!open}>
              {section.items.map((item) => (
                <Link
                  onClick={onNavigate}
                  href={item.href}
                  className={`sidebar-link ${isCurrent(loc, item.href) ? "active" : ""}`}
                  aria-current={isCurrent(loc, item.href) ? "page" : undefined}
                  key={item.href}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function WorkspaceShell({ children }: { children: ReactNode }) {
  const [loc, setLocation] = useLocation();
  const [mobile, setMobile] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const { signOutUser } = useAuth();
  const session = useSession();
  const role = session.data?.user.role;
  const access = accessFrom(role, session.data?.user.permissions);
  const activeModules = session.data?.modules ?? [];
  const notifications = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), retry: 1, enabled: !!session.data?.church },
  });
  const mark = useMarkNotificationRead();
  const qc = useQueryClient();

  // Palette and typography follow the church setting, wherever you sign in.
  const { theme, fontFamily, fontSize } = session.data ?? {};
  useEffect(() => {
    if (theme && fontFamily && fontSize) applyAppearance({ theme, fontFamily, fontSize });
  }, [theme, fontFamily, fontSize]);

  const doMark = (id: string) =>
    mark.mutate(
      { notificationId: id },
      { onSuccess: () => void qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) },
    );
  const signOutNow = async () => {
    await signOutUser();
    setLocation("/sign-in");
  };
  const unread = notifications.data?.filter((n) => !n.read) ?? [];
  const churchName = session.data?.church?.name || "Church workspace";
  const userName = session.data?.user.name || "Pastora user";

  return (
    <div className="workspace-shell">
      <aside className={`sidebar ${mobile ? "show" : ""}`}>
        <div className="sidebar-brand">
          <Brand compact />
          <button
            className="icon-button mobile-close"
            onClick={() => setMobile(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="church-avatar">{churchName.slice(0, 1).toUpperCase()}</span>
          <span>
            <b>{churchName}</b>
            <small>{roleLabel(role)}</small>
          </span>
        </div>
        <SidebarNav
          sections={navSections
            .map((section) => ({
              ...section,
              items: section.items.filter(
                (item) => (!role || item.show(access)) && (!item.module || activeModules.includes(item.module)),
              ),
            }))
            .filter((section) => section.items.length > 0)}
          loc={loc}
          onNavigate={() => setMobile(false)}
        />
        <div className="sidebar-bottom">
          {access.can("team") && (
            <Link
              href="/app/modules"
              onClick={() => setMobile(false)}
              className={`sidebar-link ${loc === "/app/modules" ? "active" : ""}`}
            >
              <Puzzle size={17} />
              <span>Modules</span>
            </Link>
          )}
          {access.can("team") && (
            <Link
              href="/app/settings"
              onClick={() => setMobile(false)}
              className={`sidebar-link ${loc === "/app/settings" ? "active" : ""}`}
            >
              <Settings2 size={17} />
              <span>Settings</span>
            </Link>
          )}
          {session.data?.platformAdmin && (
            <Link href="/admin" className="sidebar-link" onClick={() => setMobile(false)}>
              <ShieldCheck size={17} />
              <span>Pastora Admin</span>
            </Link>
          )}
          <div className="profile-row">
            <span className="profile-avatar">{userName.slice(0, 1).toUpperCase()}</span>
            <span>
              <b>{userName}</b>
              <small>{session.data?.user.email}</small>
            </span>
            <button
              className="icon-button"
              onClick={() => void signOutNow()}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobile(false)} />
      )}
      <div className="workspace-main">
        <header className="workspace-topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu size={19} />
          </button>
          <div className="crumb">
            {churchName} <span>/</span> <b>{pageTitle(loc)}</b>
          </div>
          <div className="top-actions">
            <button
              className="icon-button notification-button"
              onClick={() => setShowNotices(!showNotices)}
              aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
              aria-expanded={showNotices}
            >
              <Bell size={18} />
              {unread.length > 0 && <i />}
            </button>
            <button className="button outline small-signout" onClick={() => void signOutNow()}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
          {showNotices && (
            <div className="notice-pop">
              <div className="notice-head">
                <b>Updates</b>
                <button
                  className="plain-button"
                  onClick={() => setShowNotices(false)}
                  aria-label="Close updates"
                >
                  <X size={15} />
                </button>
              </div>
              {notifications.isLoading ? (
                <p>Loading notifications…</p>
              ) : notifications.isError ? (
                <p>Notifications are unavailable.</p>
              ) : !notifications.data?.length ? (
                <p>No new updates.</p>
              ) : (
                notifications.data.map((n) => (
                  <button
                    className={`notice-item ${n.read ? "read" : ""}`}
                    key={n.id}
                    onClick={() => {
                      if (!n.read) doMark(n.id);
                      setShowNotices(false);
                      setLocation(n.targetPath);
                    }}
                  >
                    <span>{n.title}</span>
                    <small>{new Date(n.createdAt).toLocaleDateString()}</small>
                  </button>
                ))
              )}
            </div>
          )}
        </header>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}
