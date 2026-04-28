// Next.js 16 renamed middleware.ts → proxy.ts. Same API.
// Clerk's clerkMiddleware authenticates every request, but we only ENFORCE
// protection on production (VERCEL_ENV === "production"). On dev / preview,
// the proxy is a no-op so the user can freely move around.

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (process.env.VERCEL_ENV === "production" && isProtected(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Match every path EXCEPT static assets — copied from Clerk's quickstart.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
