# Pastora Firebase setup

The Firebase connector is not available as an automatic Replit integration in this project. Pastora is prepared to use Firebase, but real sign-in, submissions, and church records stay unavailable until the owner's Firebase project is configured.

## 1. Create the Firebase project

1. Create a Firebase project in the Firebase console.
2. Enable **Authentication → Email/Password**.
3. Create the default Cloud Firestore database.
4. Create a Firebase Storage bucket only when receipt/logo uploads are ready to be enabled.
5. Add the web application and note its web configuration values.
6. Create a service account with least-privilege access for the server API. Keep its JSON private.

## 2. Configure environment values

For the web artifact, configure these Vite variables in the deployment environment:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_APP_ID`

These are Firebase web-app identifiers, not service-account credentials. Do not put service-account JSON in any `VITE_` variable.

For the API server, store the service-account JSON in the workspace Secrets manager as:

- `FIREBASE_SERVICE_ACCOUNT_JSON`

The server accepts the service-account JSON only on the server. Never paste it into chat, source files, client-side configuration, or GitHub.

## 3. Deploy Firestore rules and indexes

Install the Firebase CLI in your own deployment environment, select the correct Firebase project, then deploy:

```sh
firebase use <your-project-id>
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Firestore rules deny direct client reads and writes by default. Pastora's API uses the Firebase Admin SDK, which bypasses Firestore rules; every API route must therefore continue deriving church membership from the verified Firebase ID token and checking the user's role and record tenant before access.

The Storage rules also deny all access. Receipt and logo uploads must remain disabled until an authenticated upload flow and tenant-aware read/write rules are implemented and emulator-tested.

## 4. Local Replit setup

Set the Firebase web configuration variables and the `FIREBASE_SERVICE_ACCOUNT_JSON` server secret in Replit. Restart the `API Server` and `Pastora` workflows afterward. The app's setup status should then report Firebase as configured.

Before accepting real pastoral requests, verify:

- Email verification and password reset are enabled in Firebase Authentication.
- The server service account belongs to the same project as the web app.
- Firestore indexes finish building.
- `FIREBASE_SERVICE_ACCOUNT_JSON` is only available to the server.
- Sign-up, onboarding, cross-church access denial, private counselling notes, and public submissions are exercised against the Firebase Emulator Suite.

## 5. Subscription and launch boundaries

No payment provider is connected. Prices are intentionally unset, subscriptions remain `setup_required`, and the app does not activate paid access from a browser redirect. Configure a supported billing provider and verified server-side webhooks before offering paid plans.

The privacy policy, terms, retention settings, and public emergency notice are draft product content, not legal advice or proof of regulatory compliance. Review them for each launch jurisdiction. Verify Pastora name, trademark and domain availability before commercial launch.
