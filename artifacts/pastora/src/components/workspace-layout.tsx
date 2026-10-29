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

/**
 * One short list in everyday words, most-used first. No groups to open or close:
 * pastors told us the menu felt like too much. Admin things sit at the bottom.
 */
export const navItems: NavItem[] = [
  {
    href: "/app",
    label: "Home",
    icon: LayoutDashboard,
    show: (a) => a.can("enquiries") || a.can("calendar") || a.can("prayer"),
  },
  { href: "/app/requests", label: "Care inbox", icon: HeartHandshake, show: (a) => a.can("enquiries") || a.can("prayer") },
  { href: "/app/appointments", label: "Appointments", icon: CalendarDays, show: (a) => a.can("calendar") },
  { href: "/app/messages", label: "Sermons", icon: BookOpen, show: pastors, module: "message-prep" },
  { href: "/app/blog", label: "Blog", icon: PenLine, show: pastors, module: "blog" },
  {
    href: "/app/expenses",
    label: "Expenses",
    icon: Receipt,
    show: (a) => a.can("expenses") || a.can("payments"),
    module: "expenses",
  },
  { href: "/app/qr-codes", label: "QR codes", icon: QrCode, show: (a) => a.can("qr") },
  { href: "/app/tasks", label: "Tasks", icon: ClipboardList, show: anyone },
  { href: "/app/reports", label: "Reports", icon: FileText, show: (a) => a.can("reports"), module: "reports" },
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
  if (path.startsWith("/app/messages/")) return "Sermons";
  if (path.startsWith("/app/blog/")) return "Blog";
  return (
    (
      {
        "/app": "Home",
        "/app/requests": "Care inbox",
        "/app/appointments": "Appointments",
        "/app/tasks": "Tasks",
        "/app/qr-codes": "QR codes",
        "/app/reports": "Reports",
        "/app/expenses": "Expenses",
        "/app/team": "Team",
        "/app/settings": "Settings",
        "/app/modules": "Modules",
        "/app/messages": "Sermons",
        "/app/blog": "Blog",
        "/app/account": "Your account",
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

/** The menu, with a soft fade at the bottom when there is more to scroll to. */
function SidebarNav({ items, loc, onNavigate }: { items: NavItem[]; loc: string; onNavigate: () => void }) {
  const [more, setMore] = useState({ above: false, below: false });
  const navRef = useRef<HTMLElement>(null);

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
    return () => {
      nav.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [items.length]);

  return (
    <nav
      ref={navRef}
      className={`sidebar-nav simple ${more.above ? "more-above" : ""} ${more.below ? "more-below" : ""}`}
      aria-label="Workspace"
    >
      {items.map((item) => (
        <Link
          onClick={onNavigate}
          href={item.href}
          className={`sidebar-link ${isCurrent(loc, item.href) ? "active" : ""}`}
          aria-current={isCurrent(loc, item.href) ? "page" : undefined}
          key={item.href}
        >
          <item.icon size={18} />
          <span>{item.label}</span>
        </Link>
      ))}
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
          items={navItems.filter(
            (item) => (!role || item.show(access)) && (!item.module || activeModules.includes(item.module)),
          )}
          loc={loc}
          onNavigate={() => setMobile(false)}
        />
        <div className="sidebar-bottom">
          {access.can("team") && (
            <Link
              href="/app/team"
              onClick={() => setMobile(false)}
              className={`sidebar-link ${loc === "/app/team" ? "active" : ""}`}
            >
              <Users size={17} />
              <span>Team</span>
            </Link>
          )}
          {access.can("team") && session.data?.modulesVisible && (
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
            <Link href="/app/account" className="profile-link" title="Your account and email settings">
              <b>{userName}</b>
              <small>{session.data?.user.email}</small>
            </Link>
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
              <Link href="/app/account" className="notice-settings" onClick={() => setShowNotices(false)}>
                Email settings
              </Link>
            </div>
          )}
        </header>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}
