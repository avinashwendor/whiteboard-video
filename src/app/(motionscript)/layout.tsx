import type { Metadata } from "next";
import {
  Anton,
  Archivo_Black,
  Bebas_Neue,
  Bungee,
  Caveat,
  Geist,
  Geist_Mono,
  Instrument_Serif,
  Permanent_Marker,
  Playfair_Display,
  Space_Grotesk,
  Syne,
} from "next/font/google";
import Script from "next/script";
import { buildLocaleBootScript } from "@/motionscript/lib/i18n";
import "./motionscript.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The display faces, matching `overlay/typefaces.ts` variable for variable.
 *
 * All of them are self-hosted by `next/font` at build time, so none of this
 * costs a request to Google at runtime. `display: "swap"` is deliberate on
 * every one: a caption that renders in a fallback for 100ms in the DOM is
 * nothing, and the canvas does not use these until `ensureTypefaces()` has
 * actually loaded them.
 */
const marker = Permanent_Marker({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const bebas = Bebas_Neue({
  variable: "--font-bebas",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const archivo = Archivo_Black({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  display: "swap",
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const grotesk = Space_Grotesk({
  variable: "--font-grotesk",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

const bungee = Bungee({
  variable: "--font-bungee",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

/** Every font variable, in one string, for the html element's class. */
const FONT_VARIABLES = [
  geistSans.variable,
  geistMono.variable,
  marker.variable,
  anton.variable,
  bebas.variable,
  archivo.variable,
  syne.variable,
  playfair.variable,
  instrument.variable,
  grotesk.variable,
  bungee.variable,
  caveat.variable,
].join(" ");

// The editor's own root layout: it owns the whole viewport and carries its own
// light/dark toggle, so it cannot sit inside Motionhouse's dark-only chrome.
// No analytics are mounted here — see lib/telemetry.ts.

const title = "MotionScript — edit video like you edit text";
const description =
  "Motionhouse's transcript-based video editor. Cut, caption and compose in the browser; nothing is uploaded.";

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
      className={`${FONT_VARIABLES} h-full antialiased`}
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
