/**
 * Edge middleware: gate the dashboard + protected APIs behind a valid session,
 * and bounce logged-in users away from the auth pages.
 *
 * Uses jose (edge-safe) via verifySessionToken. The media route is left open
 * here because platforms (IG/FB) and CDNs fetch it unauthenticated; production
 * deployments should front media with signed URLs / a CDN instead.
 */
import { NextResponse, type NextRequest } from "next/server";
// Import from the edge-safe session module ONLY — auth.ts pulls in Prisma /
// bcrypt / node:path which can't run in the Edge middleware runtime.
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/register"];
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/social/callback/", "/api/media/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isAuthPage = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  // Authenticated users shouldn't see login/register.
  if (isAuthPage) {
    if (session) return NextResponse.redirect(new URL("/dashboard", req.url));
    return NextResponse.next();
  }

  if (isPublicApi) return NextResponse.next();

  // Everything else under /dashboard or /api requires a session.
  const isProtected = pathname.startsWith("/dashboard") || pathname.startsWith("/api/");
  if (isProtected && !session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match everything except Next.js internals and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
