"use client";

import { useAuth, UserButton, SignInButton } from "@clerk/nextjs";

// process.env.NEXT_PUBLIC_* is inlined at build time, so this is a static
// boolean in the bundle — no perf hit, no runtime lookup.
const HAS_CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export function UserMenu() {
  if (!HAS_CLERK) return null;
  return <UserMenuInner />;
}

function UserMenuInner() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) {
    return (
      <UserButton
        appearance={{
          variables: { colorPrimary: "#3b82f6" },
          elements: {
            avatarBox: "w-8 h-8",
          },
        }}
        userProfileMode="modal"
      />
    );
  }
  return (
    <SignInButton mode="modal">
      <button className="text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer">
        Sign in
      </button>
    </SignInButton>
  );
}
