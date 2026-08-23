import type { Metadata } from "next";
import { Geist, Geist_Mono, Permanent_Marker } from "next/font/google";
import Script from "next/script";
import { buildLocaleBootScript } from "@/rescript/lib/i18n";
import "./rescript.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Backs the "Marker" text style in the composition panel. */
const marker = Permanent_Marker({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: "400",
});

// Ported from MotionScript's own root layout. Upstream also mounted Google
// Analytics and Vercel Web Analytics pointed at getrescript.com's properties;
// those are the upstream project's accounts, not ours, so they are left out.

const title = "Video Whiteboard Generator — edit videos like you edit text";
const description =
  "A fully offline, open-source transcript-based video editor. Generate compelling whiteboard animations in seconds.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title,
  description,
  icons: {
    icon: "/whiteboard-icon.jpg",
    apple: "/whiteboard-apple-icon.jpg",
  },
  openGraph: {
    type: "website",
    siteName: "Video Whiteboard Generator",
    url: "/video-editor",
    title,
    description,
    images: [
      {
        url: "/whiteboard-og.jpg",
        width: 1200,
        height: 630,
        alt: "Video Whiteboard Generator — edit and generate videos in the browser",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/whiteboard-og.jpg"],
  },
  robots: { index: false },
};

/**
 * One appearance now, matching the rest of the site.
 *
 * Inline so the class lands before first paint rather than after a white
 * flash. There is no stored preference to read any more — the light theme was
 * retired when the palette moved onto the Motionhouse greys, which only make
 * sense on a dark ground.
 */
const appearanceBootScript = `document.documentElement.classList.add("dark");`;
const localeBootScript = buildLocaleBootScript();

export default function MotionScriptLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${marker.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="appearance-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: appearanceBootScript }}
        />
        <Script
          id="locale-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: localeBootScript }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
