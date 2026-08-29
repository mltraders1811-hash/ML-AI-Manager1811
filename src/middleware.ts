import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

// Installability assets. A browser fetches the manifest and the service
// worker script outside the page's own request - and a service worker that
// gets a login redirect fails registration with a MIME-type error rather
// than anything that names the real problem. None of these reveal any data.
const PUBLIC_FILES = ["/manifest.webmanifest", "/sw.js", "/offline"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (PUBLIC_FILES.includes(pathname) || pathname.startsWith("/icons/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySessionToken(token);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Protect every page and API route except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
