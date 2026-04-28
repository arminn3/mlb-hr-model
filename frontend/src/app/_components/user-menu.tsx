"use client";

import { Show, UserButton, SignInButton } from "@clerk/nextjs";

// process.env.NEXT_PUBLIC_* is inlined at build time, so this is a static
// boolean in the bundle — no perf hit, no runtime lookup.
const HAS_CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function UserMenu() {
  if (!HAS_CLERK) return null;
  return (
    <>
      <Show when="signed-in">
        <UserButton
          appearance={{
            elements: { avatarBox: "w-8 h-8" },
          }}
          userProfileMode="modal"
        />
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer">
            Sign in
          </button>
        </SignInButton>
      </Show>
    </>
  );
}
