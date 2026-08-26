/**
 * Keeps the sign-in alive.
 *
 * The access token is short by design, so something has to trade the refresh
 * token for a new pair before it lapses — and middleware is the only place that
 * can. Server components cannot set cookies, and the browser cannot refresh
 * because both cookies are httpOnly, which is exactly the property that makes
 * them safe.
 *
 * Middleware can do both halves: it rewrites the *request* cookies so the page
 * rendering right now sees the new token, and sets them on the *response* so
 * the browser keeps them.
 */

import { type NextRequest, NextResponse } from "next/server";

const ACCESS = "pms_access";
const REFRESH = "pms_refresh";
const CSRF = "csrftoken";
const BACKEND = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

/** Refresh this far ahead of expiry so it never dies mid-request. */
const LEEWAY_SECONDS = 120;

const PUBLIC = ["/sign-in", "/api/proxy/api/auth/"];

function isPublic(pathname: string): boolean {
  return PUBLIC.some((p) => pathname.startsWith(p));
}

/**
 * Seconds left on the token, read from its unverified payload.
 *
 * Unverified is fine: this only decides *when to ask the backend*. Django
 * verifies the signature on every request that matters, so the worst a forged
 * `exp` buys is one wasted refresh call that then fails.
 */
function secondsLeft(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === "number" ? exp - Math.floor(Date.now() / 1000) : 0;
  } catch {
    return 0;
  }
}

function cookieValue(setCookie: string, name: string): string | null {
  const first = setCookie.split(";")[0];
  const eq = first.indexOf("=");
  if (eq < 0) return null;
  return first.slice(0, eq).trim() === name ? first.slice(eq + 1) : null;
}

export async function middleware(request: NextRequest) {
  const response = await route(request);
  return withCsrfCookie(request, response);
}

/**
 * Make sure the browser actually holds Django's CSRF cookie.
 *
 * Cookie-authenticated writes are CSRF-checked, and the token is minted by
 * Django on a couple of GET endpoints. But every page here reads its data
 * server-side, so those Set-Cookie headers land on the Next server's fetch and
 * never reach the browser — leaving client-side writes to fail with "CSRF
 * cookie not set". Topping it up here happens once per session, before the
 * first page renders, so the first write already has what it needs.
 */
async function withCsrfCookie(request: NextRequest, response: NextResponse) {
  if (request.cookies.get(CSRF)) return response;

  try {
    const upstream = await fetch(`${BACKEND}/api/auth/config`, { cache: "no-store" });
    for (const cookie of upstream.headers.getSetCookie()) {
      if (cookieValue(cookie, CSRF) !== null) response.headers.append("set-cookie", cookie);
    }
  } catch {
    // Backend down. The page itself will say so; a missing CSRF cookie is the
    // lesser problem and resolves on the next request.
  }
  return response;
}

async function route(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const access = request.cookies.get(ACCESS)?.value;
  const refresh = request.cookies.get(REFRESH)?.value;

  if (access && secondsLeft(access) > LEEWAY_SECONDS) return NextResponse.next();

  if (refresh) {
    const refreshed = await tryRefresh(request, refresh);
    if (refreshed) return refreshed;
    // Rejected — expired, revoked or replayed. Fall through to signed-out
    // rather than rendering a page that will 401 on everything it asks for.
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    // API callers want a status code, not a login page they cannot render.
    return NextResponse.json({ detail: "Not signed in." }, { status: 401 });
  }

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

async function tryRefresh(request: NextRequest, refresh: string) {
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${REFRESH}=${refresh}` },
      cache: "no-store",
    });
  } catch {
    // Backend unreachable. Not a sign-out: let the page render and report the
    // outage, which is far more useful than a login screen.
    return NextResponse.next();
  }

  if (!upstream.ok) return null;

  const setCookies = upstream.headers.getSetCookie();
  const newAccess = setCookies.map((c) => cookieValue(c, ACCESS)).find(Boolean);
  const newRefresh = setCookies.map((c) => cookieValue(c, REFRESH)).find(Boolean);
  if (!newAccess) return null;

  const headers = new Headers(request.headers);
  request.cookies.set(ACCESS, newAccess);
  if (newRefresh) request.cookies.set(REFRESH, newRefresh);
  headers.set("cookie", request.cookies.toString());

  const response = NextResponse.next({ request: { headers } });
  // Relay Django's own Set-Cookie lines verbatim: it owns the lifetimes and
  // flags, and a second opinion here would eventually disagree with it.
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2)$).*)",
  ],
};
