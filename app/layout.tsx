import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Analytics from "@/components/Analytics";

export const metadata: Metadata = {
  title: "Plays — the marketplace for AI agent workflows",
  description:
    "Buy a play, drop it into your agent setup, connect your tools — and it runs. The one-stop shop for getting set up with AI.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:4720"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Analytics />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
