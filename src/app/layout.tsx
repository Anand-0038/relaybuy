import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { DevelopmentOriginCleanup } from "../components/development-origin-cleanup";
import { getSiteUrl, siteDescription, siteName } from "../config/site";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "RelayBuy — Evidence-gated purchasing for frontline teams",
    template: "%s · RelayBuy",
  },
  description: siteDescription,
  applicationName: siteName,
  category: "business",
  creator: "RelayBuy",
  keywords: [
    "frontline purchasing",
    "agentic commerce",
    "purchase approval",
    "variant verification",
    "Prava",
  ],
  alternates: { canonical: "/" },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName,
    title: "RelayBuy — Evidence-gated purchasing for frontline teams",
    description: siteDescription,
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RelayBuy — Evidence-gated purchasing",
    description: siteDescription,
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0d8b80",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: siteName,
    url: siteUrl.origin,
    description: siteDescription,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    featureList: [
      "Typed request extraction",
      "Deterministic variant refusal",
      "Budget policy enforcement",
      "Hash-bound capability-link approval",
    ],
  };

  return (
    <html data-scroll-behavior="smooth" lang="en">
      <head>
        <meta name="msapplication-TileColor" content="#0d8b80" />
        <meta name="apple-mobile-web-app-title" content="RelayBuy" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#0d8b80" />
        <script
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
          }}
          type="application/ld+json"
        />
      </head>
      <body>
        <DevelopmentOriginCleanup />
        {children}
      </body>
    </html>
  );
}
