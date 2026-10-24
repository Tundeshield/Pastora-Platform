# Pastora security model

## Trust boundaries

1. **Browser** — untrusted. Holds a Firebase ID token and the public Firebase web
   config. It can only call the Pastora API.
2. **Pastora API** (`artifacts/api-server`) — trusted. Verifies the ID token with the
   Firebase Admin SDK on every request, then:
   - derives the caller's church and role from their `churchMemberships` record
     (`tenantFor`); a church ID or role in the request is never trusted;
   - loads records by ID and rejects them unless `record.churchId` matches the caller's
     church (`tenantDocument` → 404 for other churches' records);
   - lists records only with a `churchId == caller's church` query;
   - applies the role checks in `src/lib/policies.ts`.
3. **Firestore / Storage** — Security Rules deny all client access. Only the API
   (Admin SDK) reads and writes data.

## Sensitive data

- **Counselling**: the shared `pastoralRequests` document holds only status fields; the
  name, contact and message live in `counsellingCases`, read only by pastors.
  Public counselling submissions require consent to be contacted.
- **Prayer requests**: visible to pastors only. Staff see general enquiries; finance and
  the workspace admin see no care requests at all. Anonymous requests store no name.
  Notifications follow the same rule: prayer and counselling alerts go to pastors only.
- **Private pastoral notes** (`pastoralNotes`) are restricted and every note is audited.
- **Finance**: expenses follow a strict status machine enforced inside a Firestore
  transaction — `submitted → approved | rejected | clarification`,
  `clarification → approved | rejected`, `approved → paid`. Requesters cannot review
  their own requests; payment must be recorded by a finance member who is neither the
  requester nor the approver, with a payment reference. Approved or paid requests
  cannot be changed. Each decision is written to `auditLogs` with from/to status.

## Accounts and roles

- Creating a workspace requires a **verified email**. The creator becomes Pastor, or
  Workspace admin when setting it up for their pastor; an admin never sees pastoral
  care, the calendar, reports or expenses.
- Others join only through an invitation from a pastor or admin, accepted automatically
  when the invitee signs in with that **verified** email (so nobody can claim an invite
  by registering someone else's address).
- Nobody can change their own role. Once a church has a pastor, only a pastor can add
  a pastor or change a pastor's access, so an admin cannot grant themselves (or a
  second account) pastoral access. Before the first pastor joins, the admin who set the
  church up is trusted to invite the right person. Every team change notifies the
  pastors. Deactivated members lose access immediately.
- Roles stored by earlier versions are read as: owner/counsellor → pastor,
  department leader → staff (`normalizeRole`).
- **Pastora Admin** (`/admin`) is for Pastora's own team, granted only server-side
  (`PLATFORM_ADMIN_EMAILS` with a verified email, or a `platformAdmin` custom claim).
  It can pause a church (every API call for it returns 403 and its public page 404),
  disable an account (tokens are verified with `checkRevoked`, so this takes effect on
  the next request), and change a member's role to rescue a church. It reads no
  pastoral content. Actions are logged in `platformAuditLogs`; role changes also go to
  the church's own audit log and notify its pastors and admins.
- Onboarding runs in a single transaction: retries and double-submits return the same
  workspace instead of creating duplicates; public addresses (slugs) are reserved
  atomically. A per-person `membershipLocks/{uid}` document, written with `create()`,
  guarantees one church per account even under real concurrency (found and verified
  by the emulator tests).

## Public endpoints

- `GET /api/public/churches/:slug` returns only the public profile.
- `POST /api/public/churches/:slug/requests` is rate limited (8/min per IP) and can
  only create records; it returns a short reference, never data.
- `POST /api/public/qr-codes/:id/visit` increments a counter, stores no personal data,
  and always returns 204 so link IDs cannot be probed.
- QR links contain only the church slug, the form type and the QR id.

## Operational notes

- Keep the service-account key only in server-side environment variables (Netlify
  Functions scope, marked secret). Never in `VITE_*` variables, the repo or chat.
- The Firebase web API key is a public identifier. Restrict it to your domains in
  Google Cloud Console → APIs & Services → Credentials for defence in depth.
- Use a separate Firebase project for development and testing.
- API responses are sent with `Cache-Control: no-store`.
