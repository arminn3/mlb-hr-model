import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { AgentationAutoClear } from "./_components/agentation-auto-clear";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beeb Sheets",
  description: "Daily MLB home run prop scoring — pitch-type matchup analysis powered by Statcast data.",
};

// ClerkProvider only renders if the publishable key is set. This way the app
// works fine before Clerk env vars are configured, and works fine on dev where
// you don't want a sign-in gate.
const HAS_CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tree = (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {process.env.NODE_ENV === "development" && <AgentationAutoClear />}
      </body>
    </html>
  );

  if (HAS_CLERK) {
    return (
      <ClerkProvider
        appearance={{
          baseTheme: dark,
          variables: {
            colorPrimary: "#3b82f6",
            colorBackground: "#1c1c1e",
            colorText: "#f5f5f7",
            colorTextSecondary: "#a0a1a4",
            colorInputBackground: "#141416",
            colorInputText: "#f5f5f7",
            borderRadius: "8px",
            fontFamily: "var(--font-inter)",
            spacingUnit: "0.85rem",
          },
          layout: {
            // Kill the orange "Development mode" banner on test instances.
            unsafe_disableDevelopmentModeWarnings: true,
          },
          elements: {
            // UserButton dropdown — tighter, more modern.
            userButtonPopoverCard: "w-64 shadow-2xl border border-white/10 rounded-lg",
            userButtonPopoverMain: "py-1",
            userButtonPopoverActionButton: "py-2 px-3 text-[13px] font-medium text-white hover:bg-white/5",
            userButtonPopoverActionButtonText: "text-[13px] text-white",
            userButtonPopoverActionButtonIcon: "w-4 h-4 text-white/70",
            userButtonPopoverFooter: "hidden",
            // User preview block (avatar + name + email at top of dropdown).
            userPreview: "py-2 px-3",
            userPreviewMainIdentifier: "text-[13px] font-semibold text-white",
            userPreviewSecondaryIdentifier: "text-[11px] text-white/60",
            // Sign-in / sign-up page footer chrome.
            footer: "hidden",
          },
        }}
      >
        {tree}
      </ClerkProvider>
    );
  }
  return tree;
}
