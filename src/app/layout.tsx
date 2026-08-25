import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "M.L AI Manager",
  description: "AI-powered collections & automation manager for Vyapar wholesalers",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
