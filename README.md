# Pastora

Pastoral care and church operations for multiple churches: a public care portal
(prayer, counselling, appointments, enquiries) reachable by QR code, and a private
workspace for pastors and their teams — care inbox, appointments, tasks, department
reports, expense approvals and team roles.

## Architecture

```
artifacts/pastora      React 19 + Vite + wouter web app (static)
artifacts/api-server   Express API using Firebase Admin (Auth + Firestore)
  netlify/functions    Netlify Function wrapper that serves the API at /api/*
lib/api-spec           OpenAPI spec — the source of truth for the API contract
lib/api-client-react   Generated React Query hooks (do not edit by hand)
lib/api-zod            Generated Zod validators used by the API (do not edit by hand)
firestore.rules        Deny-all: browsers never access Firestore directly
storage.rules          Deny-all: uploads are not enabled yet
```

- The browser signs in with **Firebase Authentication** and sends its ID token to the
  API. The API verifies the token, looks up the user's church membership on the
  server and enforces role checks on every request. Church IDs and roles are never
  taken from the client.
- All Firestore access happens in the API with the Admin SDK. Security Rules deny all
  client reads and writes, so a user cannot bypass the API (tested in
  `src/test/emulator/rules.test.ts`).
- Every tenant document carries `churchId`; every route scopes reads and writes to the
  caller's church. See [docs/SECURITY.md](docs/SECURITY.md).

## Booking and QR links

- **Booking (Appointments → Availability):** weekly hours in the church's time zone, meeting length, a
  break between meetings, minimum notice, how far ahead, ways to meet and time off. The care page shows
  only open slots (`GET /api/public/churches/:slug/slots`); a booking is re-checked inside a transaction
  so two people can't take the same time. Bookings confirm straight away unless the pastor turns that off.
  Until hours are set, the care page falls back to "suggest a time".
- **QR links:** each link has a purpose (welcome card, prayer, booking, confidential help, questions or the
  whole care page) and can carry its own heading and line of text. The campaign is taken from the link on
  the server, and the QR page can download a printable poster.

## Roles

Pastora keeps roles few, and a role is only a starting point: on the Team page a
pastor can tick exactly which areas each person gets (Access). Counselling, private
notes, Message Prep, the blog and approving expenses always stay with pastors.

| Role | Starts with |
| --- | --- |
| Pastor | Everything |
| Staff | General enquiries, calendar, QR links, department reports, submit expenses |
| Finance | Submit expenses, record payments (never their own or ones they approved) |
| Prayer team | Prayer requests people chose to share with the prayer team, without contact details |
| Workspace admin | Team, settings, modules and QR links |

Areas: `enquiries`, `prayer`, `calendar`, `qr`, `reports`, `expenses`, `payments`,
`team`. Access is stored on the membership and checked by the API on every request.
Only a pastor can give the people's-requests areas (enquiries, prayer, calendar), and
nobody can change their own access. Everyone keeps their own tasks.

Whoever creates a workspace chooses "I'm the pastor" (Pastor) or "I'm setting this up
for my pastor" (Workspace admin). Others join by invitation (Team page); the invitee
creates a Pastora account with that email, confirms it, and joins automatically.
Once a church has a pastor, only a pastor can add another pastor or change a pastor's
access, and pastors are notified of every team change.

Workspaces created before this model keep working: owners and counsellors are read as
pastors, department leaders as staff.

## Pastora Admin (for Pastora's own team)

`/admin` lists every church and account. It can pause or reactivate a church (its
workspace and public care page close at once), disable or re-enable an account (takes
effect on the next request), send a password reset, and fix a church's roles when no
one inside can. It never shows pastoral content. Access is granted only on the server:
set `PLATFORM_ADMIN_EMAILS` (comma-separated, verified emails) on the API, or a
`platformAdmin` custom claim. Every action is logged in `platformAuditLogs`.

## Modules

Optional features are **modules** that each church switches on in **Modules**
(pastors and workspace admins). The catalog lives in Firestore (`modules`), seeded
once from `DEFAULT_MODULES` in `artifacts/api-server/src/lib/modules.ts`, and is
managed by Pastora admins in **Pastora Admin → Modules**: add, edit, retire or delete
modules (built-in ones such as Department reports and Expenses can be retired but not
deleted), see how many churches use or want each one, and read churches' suggestions.

A church can use a module when it is *available* or *beta* and the church is entitled
to it: **early access** is on (the default, all modules free), its **plan**
(Starter / Church / Church Plus) includes it, or Pastora **granted** it free (Pastora
Admin → Churches → People). The API enforces this (`moduleGate`), so a switched-off
module is closed even to direct API calls. To make new code a module, add it to
`DEFAULT_MODULES` as built in and guard its routes with `moduleGate("<id>")`; built-in
modules are added automatically to catalogs that were seeded before they existed.

Built-in modules today: **Department reports**, **Expenses & approvals**, **Message
Prep** (each pastor's private sermon and study notes, with a pulpit view) and
**Pastor's blog** (published posts appear at `/blog/<church-address>` for anyone to
read). Formatted text in notes and posts is cleaned to a small safe subset of HTML on
the server (`src/lib/rich-text.ts`) and again in the browser before it is shown.

## Church addresses

Each church can have its own address (`<church>.getpastora.app`) for its care page
and blog once the domain is set up; until then links use `/care/<church>` and
`/blog/<church>`, which keep working afterwards. See
[docs/CHURCH_ADDRESSES.md](docs/CHURCH_ADDRESSES.md).

## Local development

Requirements: Node 22+, pnpm 10 (`corepack enable`), and Java 21+ for the emulators.

```sh
pnpm install
cp .env.example artifacts/pastora/.env.local   # fill in the Firebase web config
```

Run the API (port 8080) and the web app (port 5173; `/api` is proxied to the API):

```sh
# Terminal 1 — API. Use either a service account or the emulators (below).
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/service-account.json)"
pnpm --filter @workspace/api-server run dev

# Terminal 2 — web
pnpm --filter @workspace/pastora run dev
```

Use a **separate development Firebase project** for local work and testing, never the
production project.

### Checks

```sh
pnpm run typecheck                          # all packages
pnpm --filter @workspace/api-server test    # 37 API tests (in-memory Firestore, no network)
pnpm test:emulator                          # Security Rules + API tests on the Firebase Emulator Suite
pnpm --filter @workspace/pastora build      # production web build
```

CI (`.github/workflows/ci.yml`) runs all of these on every push.

### Changing the API

1. Edit `lib/api-spec/openapi.yaml`.
2. `pnpm --filter @workspace/api-spec run codegen` to regenerate hooks and validators.
3. Implement the route in `artifacts/api-server/src/routes` and add tests.

## Deploying to Netlify

`netlify.toml` builds the web app and the API function together; no Netlify UI build
settings are needed. Connect the GitHub repository in Netlify and set these
environment variables (Site configuration → Environment variables):

| Variable | Scope | Value |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY` | Builds | Firebase web config `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Builds | e.g. `pastora-platform.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Builds | e.g. `pastora-platform` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Builds | e.g. `pastora-platform.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Builds | Firebase web config `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | Builds | Firebase web config `appId` |
| `FIREBASE_PROJECT_ID` | Functions | Service account `project_id` |
| `FIREBASE_CLIENT_EMAIL` | Functions | Service account `client_email` |
| `FIREBASE_PRIVATE_KEY` | Functions, **secret** | Service account `private_key` (paste as-is, including the BEGIN/END lines) |

Also set `AWS_LAMBDA_JS_RUNTIME` = `nodejs22.x` (Netlify reads it from the UI/API only,
not from `netlify.toml`): firebase-admin's token verification needs Node 22.12+.

On paid Netlify plans, keep the `VITE_*` variables scoped to **Builds** only: Netlify Functions share a ~4 KB
environment limit, and the private key needs most of it.

Then in the Firebase console for the project:

1. Authentication → Sign-in method → enable **Email/Password**.
2. Authentication → Settings → **Authorized domains** → add your Netlify domain(s).
3. Deploy indexes and rules: `firebase deploy --only firestore:rules,firestore:indexes,storage --project <id>`.

Full walkthrough: [docs/FIREBASE_SETUP.md](docs/FIREBASE_SETUP.md).

The API can alternatively be deployed as a Firebase Cloud Function (`firebase.json`,
export `pastoraApi`), which requires the Blaze plan.

## What's not built yet

- **Billing**: no payment provider is connected. Plans show without prices and every
  workspace stays `setup_required`; nothing activates paid access.
- **Receipt and logo uploads**: Storage stays closed until an authenticated upload
  flow with tenant-aware rules is added.
- **Email/SMS notifications**: notifications are in-app only.
- **Appointment reminders** and automated follow-up reminders.
- **Multiple churches per person**: an account belongs to one church at a time.
- Legal pages (privacy, terms) are drafts — review them for your jurisdiction.
