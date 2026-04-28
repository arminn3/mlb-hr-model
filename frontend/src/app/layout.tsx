import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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
    return <ClerkProvider>{tree}</ClerkProvider>;
  }
  return tree;
}
