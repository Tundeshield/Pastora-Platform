/**
 * Runs the Pastora Express API as a Netlify Function at /api/*.
 *
 * The browser calls the API on the same origin as the website, so no CORS setup is
 * needed in production. Firebase Admin credentials come from server-only env vars
 * (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) — see README.
 */
import type { Config, Context } from "@netlify/functions";
import inject from "light-my-request";

import app from "../../src/app";

export default async (req: Request, context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    // The client address is passed explicitly below; forwarding headers are dropped
    // so they cannot be spoofed to dodge rate limits.
    if (key !== "x-forwarded-for" && key !== "x-real-ip") headers[key] = value;
  });
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.from(await req.arrayBuffer());

  const result = await inject(app, {
    method: req.method as "GET",
    url: `${url.pathname}${url.search}`,
    headers,
    payload: body,
    // Per-client rate limiting (public forms) needs the real visitor address.
    remoteAddress: context.ip || "0.0.0.0",
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    if (value === undefined || key === "content-length" || key === "transfer-encoding") continue;
    for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, String(item));
  }
  // Pastoral data must never be cached by browsers or the CDN.
  responseHeaders.set("cache-control", "no-store");
  const noBody = result.statusCode === 204 || result.statusCode === 304;
  return new Response(noBody ? null : new Uint8Array(result.rawPayload), { status: result.statusCode, headers: responseHeaders });
};

export const config: Config = {
  path: "/api/*",
};
