import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getGetSetupStatusQueryKey,
  getListNotificationsQueryKey,
  useGetSession,
  useGetSetupStatus,
  useListNotifications,
  useMarkNotificationRead,
} from "@workspace/api-client-react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  Menu,
  MoreHorizontal,
  QrCode,
  Receipt,
  Settings2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

import { Brand } from "@/components/ui-kit";

export const navSections = [
  {
    label: "Workspace",
    items: [
      { href: "/app", label: "Overview", icon: LayoutDashboard },
      { href: "/app/requests", label: "Care inbox", icon: HeartHandshake },
      { href: "/app/appointments", label: "Appointments", icon: CalendarDays },
      { href: "/app/tasks", label: "Tasks", icon: ClipboardList },
    ],
  },
  {
    label: "Church operations",
    items: [
      { href: "/app/qr-codes", label: "QR links", icon: QrCode },
      { href: "/app/reports", label: "Department reports", icon: FileText },
      { href: "/app/expenses", label: "Expenses", icon: Receipt },
    ],
  },
];

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [loc, setLocation] = useLocation();
  const [mobile, setMobile] = useState(false);
  const session = useGetSession({ query: { queryKey: getGetSessionQueryKey(), retry: 1 } });
  const setup = useGetSetupStatus({ query: { queryKey: getGetSetupStatusQueryKey(), retry: 1 } });
  const notifications = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), retry: 1, enabled: !!session.data },
  });
  const mark = useMarkNotificationRead();
  const qc = useQueryClient();
  const [showNotices, setShowNotices] = useState(false);
  const doMark = (id: string) =>
    mark.mutate(
      { notificationId: id },
      { onSuccess: () => void qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) },
    );
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
          <span className="church-avatar">P</span>
          <span>
            <b>{session.data?.church?.name || "Church workspace"}</b>
            <small>{session.data?.user?.role || "Workspace"}</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="sidebar-label">{section.label}</p>
              {section.items.map((item) => (
                <Link
                  onClick={() => setMobile(false)}
                  href={item.href}
                  className={`sidebar-link ${loc === item.href ? "active" : ""}`}
                  key={item.href}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                  {item.href === "/app/requests" && <i className="nav-dot" />}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <Link href="/app/settings" className={`sidebar-link ${loc === "/app/settings" ? "active" : ""}`}>
            <Settings2 size={17} />
            <span>Settings</span>
          </Link>
          <div className="profile-row">
            <span className="profile-avatar">{session.data?.user?.name?.slice(0, 1) || "P"}</span>
            <span>
              <b>{session.data?.user?.name || "Pastora workspace"}</b>
              <small>{session.data?.user?.email || "Account status"}</small>
            </span>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu size={19} />
          </button>
          <div className="crumb">
            Workspace <span>/</span> <b>{pageTitle(loc)}</b>
          </div>
          <div className="top-actions">
            <span className="workspace-chip">
              <span className="small-pulse" />
              Workspace
            </span>
            <button
              className="icon-button notification-button"
              onClick={() => setShowNotices(!showNotices)}
              aria-label="Notifications"
            >
              <Activity size={18} />
              {notifications.data?.some((n) => !n.read) && <i />}
            </button>
            <Link href="/app/settings" className="avatar-small">
              {session.data?.user?.name?.slice(0, 1) || "P"}
            </Link>
          </div>
          {showNotices && (
            <div className="notice-pop">
              <div className="notice-head">
                <b>Updates</b>
                <button className="plain-button" onClick={() => setShowNotices(false)}>
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
                    className="notice-item"
                    key={n.id}
                    onClick={() => {
                      doMark(n.id);
                      setShowNotices(false);
                      setLocation(n.targetPath);
                    }}
                  >
                    <span>
                      {n.type === "pastoral_request"
                        ? "A new care request"
                        : n.type === "follow_up"
                          ? "A pastoral follow-up"
                          : n.title}
                    </span>
                    <small>{new Date(n.createdAt).toLocaleDateString()}</small>
                  </button>
                ))
              )}
            </div>
          )}
        </header>
        <main className="workspace-content">
          {setup.data?.firebaseConfigured === false && (
            <div className="setup-banner">
              <LockKeyhole size={17} />
              <span>
                Workspace services need setup. Sign-in and church data remain unavailable until Firebase is
                configured.
              </span>
              <Link href="/support">
                Setup notes <ArrowRight size={14} />
              </Link>
            </div>
          )}
          {setup.isError && (
            <div className="setup-banner">
              <CircleHelp size={17} />
              <span>Account readiness could not be checked. Data may be unavailable.</span>
            </div>
          )}
          {session.isError && (
            <div className="workspace-gate">
              <div className="gate-icon">
                <LockKeyhole />
              </div>
              <p className="eyebrow">Restricted workspace</p>
              <h2 className="serif">Sign-in required.</h2>
              <p>
                Pastoral and church workspace information is only shown to authorised members. No sample
                records are displayed.
              </p>
              <Link href="/sign-in" className="button primary">
                Go to sign in <LogIn size={15} />
              </Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
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
        "/app/settings": "Settings",
      } as Record<string, string>
    )[path] || "Workspace"
  );
}
