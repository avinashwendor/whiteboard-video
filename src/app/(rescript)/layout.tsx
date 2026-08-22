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

// Ported from Rescript's own root layout. Upstream also mounted Google
// Analytics and Vercel Web Analytics pointed at getrescript.com's properties;
// those are the upstream project's accounts, not ours, so they are left out.

const title = "Rescript — edit videos like you edit text";
const description =
  "A fully offline, open-source transcript-based video editor. Transcribe with Whisper, cut by deleting words, export with ffmpeg — on your device.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title,
  description,
  icons: {
    icon: "/rescript-icon.png",
    apple: "/rescript-apple-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Rescript",
    url: "/rescript",
    title,
    description,
    images: [
      {
        url: "/rescript-og.png",
        width: 1200,
        height: 630,
        alt: "Rescript — a transcript-based video editor running in the browser",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/rescript-og.png"],
  },
  robots: { index: false },
};

/** Apply stored appearance before paint to avoid a light→dark flash. */
const appearanceBootScript = `(function(){try{if(localStorage.getItem("rescript.appearance")==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`;
const localeBootScript = buildLocaleBootScript();

export default function RescriptLayout({
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
