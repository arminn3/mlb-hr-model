// Next.js 16 renamed middleware.ts → proxy.ts. Same API, same NextRequest /
// NextResponse. We use Clerk's clerkMiddleware to authenticate requests, but
// only ENFORCE protection on production. On dev / preview / before Clerk keys
// are set, the proxy is a passthrough so the user can freely move around.

import { NextResponse, type NextRequest } from "next/server";

const HAS_CLERK_KEYS =
  !!process.env.CLERK_SECRET_KEY &&
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const IS_PROD = process.env.VERCEL_ENV === "production";

// Lazy-load Clerk so the integration is a no-op when keys aren't set
// (e.g., right after install, before the user has put keys in Vercel).
async function buildHandler() {
  if (!HAS_CLERK_KEYS) {
    return (_req: NextRequest) => NextResponse.next();
  }
  const { clerkMiddleware, createRouteMatcher } = await import(
    "@clerk/nextjs/server"
  );
  const isProtected = createRouteMatcher(["/dashboard(.*)"]);
  return clerkMiddleware(async (auth, req) => {
    if (IS_PROD && isProtected(req)) {
      await auth.protect();
    }
  });
}

const handlerPromise = buildHandler();

export default async function proxy(req: NextRequest) {
  const handler = await handlerPromise;
  // Clerk middleware expects (req, event); pass undefined since we don't need
  // the event payload here.
  return (handler as (r: NextRequest, e?: unknown) => Promise<Response>)(
    req,
    undefined,
  );
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
