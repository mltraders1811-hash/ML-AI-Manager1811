import type { Metadata, Viewport } from "next";

import { PwaSetup } from "@/components/PwaSetup";

import "./globals.css";

export const metadata: Metadata = {
  title: "M.L AI Manager",
  description: "AI-powered collections & automation manager for Vyapar wholesalers",
  manifest: "/manifest.webmanifest",
  applicationName: "M.L AI Manager",
  // iOS ignores the manifest almost entirely and reads these instead.
  appleWebApp: { capable: true, title: "M.L Manager", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#166534",
  // The tables are wide; pinch-zoom is how you read them on a phone, so
  // don't lock the scale.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaSetup />
      </body>
    </html>
  );
}
