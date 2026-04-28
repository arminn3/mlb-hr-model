import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
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
}
