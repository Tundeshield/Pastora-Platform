import type { MemberRole, Permission } from "@workspace/api-client-react";

import { useSession } from "@/auth";

/** Mirrors api-server/src/lib/policies.ts; the server is the source of truth. */
export const PERMISSIONS: Permission[] = ["enquiries", "prayer", "calendar", "qr", "reports", "expenses", "payments", "team"];

export const ROLE_DEFAULTS: Record<MemberRole, Permission[]> = {
  pastor: PERMISSIONS,
  staff: ["enquiries", "calendar", "qr", "reports", "expenses"],
  finance: ["expenses", "payments"],
  admin: ["team", "qr"],
  prayer_team: ["prayer"],
};

/** Access to people's requests and the calendar: only a pastor can give it. */
export const CARE_PERMISSIONS: Permission[] = ["enquiries", "prayer", "calendar"];

export const AREAS: { group: string; items: { key: Permission; label: string; help: string }[] }[] = [
  {
    group: "People's requests",
    items: [
      { key: "enquiries", label: "General enquiries", help: "Read and answer general enquiries in the care inbox." },
      {
        key: "prayer",
        label: "Shared prayer requests",
        help: "Prayer requests people chose to share with the prayer team. Never contact details.",
      },
      { key: "calendar", label: "Pastor's calendar", help: "See and arrange the pastor's appointments." },
    ],
  },
  {
    group: "Church office",
    items: [
      { key: "qr", label: "QR links", help: "Create and print QR codes for the care page." },
      { key: "reports", label: "Department reports", help: "Submit reports for their department." },
      { key: "expenses", label: "Submit expenses", help: "Ask for money to be spent, for a pastor to approve." },
      { key: "payments", label: "Record payments", help: "Mark approved expenses as paid, with a reference." },
    ],
  },
  {
    group: "Administration",
    items: [{ key: "team", label: "Team, settings & modules", help: "Invite people, change access and settings." }],
  },
];

export const AREA_LABEL: Record<Permission, string> = Object.fromEntries(
  AREAS.flatMap((g) => g.items.map((i) => [i.key, i.label])),
) as Record<Permission, string>;

export type Access = { role: MemberRole | undefined; isPastor: boolean; can: (p: Permission) => boolean };

export function accessFrom(role: MemberRole | undefined, permissions: Permission[] | undefined): Access {
  const isPastor = role === "pastor";
  return { role, isPastor, can: (p) => isPastor || Boolean(permissions?.includes(p)) };
}

/** What the signed-in person can see and do in their church. */
export function useAccess(): Access {
  const user = useSession().data?.user;
  return accessFrom(user?.role, user?.permissions);
}
