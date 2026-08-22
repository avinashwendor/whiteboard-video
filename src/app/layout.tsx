import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Permanent_Marker } from "next/font/google";
import { StudioProvider } from "@/lib/studio/use-studio";
import { TopBar } from "@/components/site/top-bar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Used only inside the whiteboard canvas -- chunky marker lettering is the look. */
const marker = Permanent_Marker({ variable: "--font-hand", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Chalkline — turn one idea into a whiteboard video",
  description:
    "Describe an idea and get a narrated whiteboard explainer: a written script, hand-drawn sketches, and a natural voice, assembled into a video you can export.",
  applicationName: "Chalkline",
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${marker.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg">
        <StudioProvider>
          <TopBar />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-line px-5 py-6">
            <p className="mx-auto max-w-6xl text-[11px] leading-relaxed text-faint">
              Text by Omega C · Images by Puter with a Pollinations fallback · Voice by Cartesia.
              Generations are kept in this browser only.
            </p>
          </footer>
        </StudioProvider>
      </body>
    </html>
  );
}
