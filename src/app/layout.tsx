import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OUTBREAK",
  description: "GPS zombie survival co-op",
  icons: {
    icon: "/icons/icon-192.png",
  },
  openGraph: {
    title: "OUTBREAK",
    description: "GPS zombie survival co-op",
    images: ["/brand/banner-169.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "OUTBREAK",
    description: "GPS zombie survival co-op",
    images: ["/brand/banner-916.webp"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
