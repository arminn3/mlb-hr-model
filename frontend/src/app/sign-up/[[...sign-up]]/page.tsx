import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";

const HAS_CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function SignUpPage() {
  if (!HAS_CLERK) redirect("/landing");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <SignUp
        appearance={{ variables: { colorPrimary: "#3b82f6" } }}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/dashboard"
      />
    </main>
  );
}
