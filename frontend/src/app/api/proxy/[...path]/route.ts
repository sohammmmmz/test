/**
 * Server-side pass-through to Django for client components.
 *
 * Client components cannot call Django directly: the auth cookies are httpOnly
 * and the backend is not necessarily reachable from the browser. They call here
 * instead and this forwards with the cookies attached.
 *
 * The upstream path comes from `nextUrl.pathname`, not from rejoining the
 * catch-all segments — Next drops the trailing slash when it splits them, and
 * DRF registers its routes *with* one, so a rejoined path turns every write
 * into a redirect Django cannot follow for a POST without losing the body.
 */

import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
const PREFIX = "/api/proxy";

// Hop-by-hop and body-framing headers must not be relayed; Node sets its own.
const STRIPPED = new Set([
  "host", "connection", "content-length", "transfer-encoding",
  "keep-alive", "upgrade", "accept-encoding",
]);

async function forward(request: NextRequest) {
  const store = await cookies();
  const cookieHeader = store.getAll().map((c) => `${c.name}=${c.value}`).join("; ");

  const upstreamPath = request.nextUrl.pathname.slice(PREFIX.length) || "/";
  const target = `${BACKEND}${upstreamPath}${request.nextUrl.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED.has(key.toLowerCase())) headers.set(key, value);
  });
  if (cookieHeader) headers.set("Cookie", cookieHeader);
  // Django checks Origin/Referer against CSRF_TRUSTED_ORIGINS.
  headers.set("Referer", request.nextUrl.origin);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  if (hasBody) {
    const csrf = store.get("csrftoken")?.value;
    if (csrf) headers.set("X-CSRFToken", csrf);
  }

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  const out = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) out.set("content-type", contentType);

  // Relay the redirect target. Without this a 302 from Django arrives at the
  // browser with no Location and renders as a blank page — which is exactly
  // what the GitLab sign-in did. Django's own targets are paths rooted at
  // *its* origin, so they are rewritten back inside the proxy prefix;
  // absolute URLs (GitLab's authorize endpoint) pass through untouched.
  const location = response.headers.get("location");
  if (location) {
    out.set(
      "location",
      location.startsWith("/") && !location.startsWith(PREFIX)
        ? `${PREFIX}${location}`
        : location,
    );
  }

  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") out.append("set-cookie", value);
  }

  return new NextResponse(response.body, { status: response.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
