import { useQueryClient } from "@tanstack/react-query";
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkNotificationRead,
  type UserSummaryRole,
} from "@workspace/api-client-react";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  Receipt,
  Settings2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import { RequireWorkspace, useAuth, useSession } from "@/auth";
import { Brand } from "@/components/ui-kit";
import { applyTheme } from "@/theme";

type NavItem = { href: string; label: string; icon: LucideIcon; roles: UserSummaryRole[] };

const ALL: UserSummaryRole[] = ["owner", "pastor", "counsellor", "staff", "department_leader", "finance"];

/** Navigation mirrors the API's role checks so people only see pages they can use. */
export const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      {
        href: "/app",
        label: "Overview",
        icon: LayoutDashboard,
        roles: ["owner", "pastor", "counsellor", "staff"],
      },
      { href: "/app/requests", label: "Care inbox", icon: HeartHandshake, roles: ALL },
      {
        href: "/app/appointments",
        label: "Appointments",
        icon: CalendarDays,
        roles: ["owner", "pastor", "counsellor", "staff"],
      },
      { href: "/app/tasks", label: "Tasks", icon: ClipboardList, roles: ALL },
    ],
  },
  {
    label: "Church operations",
    items: [
      { href: "/app/qr-codes", label: "QR links", icon: QrCode, roles: ["owner", "pastor", "staff"] },
      {
        href: "/app/reports",
        label: "Department reports",
        icon: FileText,
        roles: ["owner", "pastor", "department_leader", "staff"],
      },
      {
        href: "/app/expenses",
        label: "Expenses",
        icon: Receipt,
        roles: ["owner", "pastor", "staff", "department_leader", "finance"],
      },
      { href: "/app/team", label: "Team", icon: Users, roles: ["owner", "pastor"] },
    ],
  },
];

const ROLE_LABELS: Record<UserSummaryRole, string> = {
  owner: "Owner",
  pastor: "Pastor",
  counsellor: "Counsellor",
  staff: "Staff",
  department_leader: "Department leader",
  finance: "Finance",
};

export function roleLabel(role: UserSummaryRole | undefined): string {
  return role ? ROLE_LABELS[role] : "Member";
}

export function pageTitle(path: string) {
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
      } as Record<string, string>
    )[path] || "Workspace"
  );
}

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <RequireWorkspace>
      <WorkspaceShell>{children}</WorkspaceShell>
    </RequireWorkspace>
  );
}

function WorkspaceShell({ children }: { children: ReactNode }) {
  const [loc, setLocation] = useLocation();
  const [mobile, setMobile] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const { signOutUser } = useAuth();
  const session = useSession();
  const role = session.data?.user.role;
  const notifications = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), retry: 1, enabled: !!session.data?.church },
  });
  const mark = useMarkNotificationRead();
  const qc = useQueryClient();

  // The workspace theme follows the church setting, wherever you sign in.
  useEffect(() => {
    if (session.data?.theme) applyTheme(session.data.theme);
  }, [session.data?.theme]);

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
        <nav className="sidebar-nav" aria-label="Workspace">
          {navSections.map((section) => {
            const items = section.items.filter((item) => !role || item.roles.includes(role));
            if (!items.length) return null;
            return (
              <div key={section.label}>
                <p className="sidebar-label">{section.label}</p>
                {items.map((item) => (
                  <Link
                    onClick={() => setMobile(false)}
                    href={item.href}
                    className={`sidebar-link ${loc === item.href ? "active" : ""}`}
                    aria-current={loc === item.href ? "page" : undefined}
                    key={item.href}
                  >
                    <item.icon size={17} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {(role === "owner" || role === "pastor") && (
            <Link
              href="/app/settings"
              onClick={() => setMobile(false)}
              className={`sidebar-link ${loc === "/app/settings" ? "active" : ""}`}
            >
              <Settings2 size={17} />
              <span>Settings</span>
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
