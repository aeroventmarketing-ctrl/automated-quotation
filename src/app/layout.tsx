import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

export const metadata: Metadata = {
  title: "AeroQuote — Aerovent Quotation System",
  description: "Turn fan & blower inquiries into printable quotations in minutes.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AeroQuote", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-muted/30 antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
