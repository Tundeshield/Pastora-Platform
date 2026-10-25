# Church addresses (`<church>.getpastora.app`)

Each church can have its own web address: `https://<church-address>.<base-domain>`
shows its care page and `/blog` its blog. Pastora's website and workspace stay on
`www.<base-domain>`. The app supports this today; it switches on with one setting.

Until it is switched on, and forever afterwards on the main host, the path form keeps
working: `/care/<church-address>` and `/blog/<church-address>`. Printed QR codes and
shared links never break.

## How it works

- `artifacts/pastora/src/site.ts` reads `VITE_PUBLIC_BASE_DOMAIN`. On
  `<church>.<base>` it renders only that church's pages (`/`, `/blog`,
  `/blog/<post>`); anything else is sent to the main site. Every shareable link
  (QR codes, blog links, "View" buttons) is built with `churchUrl()`.
- Church addresses come from the church name and can never be a reserved host name
  (`www`, `app`, `api`, `admin`, …; see `RESERVED_ADDRESSES` in `site.ts` and
  `lib/workspace-service.ts`).
- The API is the same Netlify Function on every host (`/api/*`), so nothing changes
  on the server.

## Turning it on (in this order)

1. **Buy the domain**, e.g. `getpastora.app`. Buying it through Netlify uses Netlify
   DNS automatically; if bought elsewhere, point its nameservers to Netlify DNS.
2. **Netlify plan:** wildcard subdomains need a Pro (or higher) team, and Netlify
   support switches them on for the site.
3. **Netlify domain settings:** make `www.getpastora.app` the primary domain of the
   `pastora-platform` site. In Netlify DNS add a record `*` → CNAME →
   `pastora-platform.netlify.app`.
4. **Ask Netlify support** to enable wildcard subdomains for the `pastora-platform`
   site (they issue the wildcard certificate). Confirm that
   `https://anything.getpastora.app` loads Pastora.
5. **Only then** set the environment variable `VITE_PUBLIC_BASE_DOMAIN=getpastora.app`
   (all scopes) and redeploy. Links and QR codes created after this use church
   addresses.
6. **Firebase:** Authentication → Settings → Authorized domains → add
   `www.getpastora.app`.

Setting the variable before step 4 works would make new QR codes point to addresses
that don't load yet, so keep that order.
