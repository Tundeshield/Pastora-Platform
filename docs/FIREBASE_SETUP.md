# Pastora Firebase setup

Production project: **`pastora-platform`** (web app ID `1:257883255267:web:bc944a6b891d5cb5d5b0d6`).

## 1. Firebase console (one-time)

1. **Authentication → Sign-in method** → enable **Email/Password**.
2. **Authentication → Settings → Authorized domains** → add every domain the site is
   served from (e.g. `your-site.netlify.app` and your custom domain). Sign-in fails on
   domains that are not listed.
3. **Authentication → Templates** (optional) → customise the verification and
   password-reset emails and sender name.
4. **Firestore Database** → create the default database (production mode) if it does
   not exist yet. Choose a region close to your users; it cannot be changed later.
5. Storage is not used yet; leave it disabled or keep the deny-all rules.

## 2. Server credentials (service account)

The API needs a service account to verify sign-ins and read/write Firestore.

1. Firebase console → ⚙ Project settings → **Service accounts** → **Generate new
   private key**. A JSON file downloads. Treat it like a password.
2. In Netlify → Site configuration → Environment variables, add (scope **Functions**):
   - `FIREBASE_PROJECT_ID` = `project_id` from the JSON
   - `FIREBASE_CLIENT_EMAIL` = `client_email` from the JSON
   - `FIREBASE_PRIVATE_KEY` = `private_key` from the JSON, marked **secret**. Paste the
     value exactly; `\n` sequences are converted automatically.
3. Delete the downloaded JSON once the values are stored, or keep it in a password
   manager. Never commit it, paste it into chat or put it in a `VITE_*` variable.

Locally you can instead export the whole file:
`export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat key.json)"`.

## 3. Web configuration (public)

Set the `VITE_FIREBASE_*` variables from Project settings → General → Your apps (scope
**Builds**). They are public identifiers that ship to every browser; access is
protected by the API, not by keeping these values secret. See `.env.example`.

## 4. Rules and indexes

```sh
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes --project pastora-platform
```

Indexes take a few minutes to build. The rules deny all direct browser access by
design (see docs/SECURITY.md).

## 5. A development project for testing

Create a second project (e.g. `pastora-dev`) with the same settings and use its
credentials for local work and manual testing, so test accounts and sample requests
never touch production. Automated tests use the emulators (`pnpm test:emulator`) and
need no project at all.

## 6. Launch boundaries

- No payment provider is connected. Prices are unset and subscriptions remain
  `setup_required`; nothing activates paid access.
- Privacy policy, terms and the emergency notice are drafts, not legal advice.
- Verify the Pastora name, trademark and domain before commercial launch.
