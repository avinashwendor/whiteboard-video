import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Permanent_Marker } from "next/font/google";
import { TopBar } from "@/components/site/top-bar";
import { StudioProvider } from "@/lib/studio/use-studio";
import { AuthProvider } from "@/components/site/auth";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Used only inside the whiteboard canvas -- chunky marker lettering is the look. */
const marker = Permanent_Marker({ variable: "--font-hand", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Motionhouse — create, edit and enhance video",
  description:
    "Generate a video from an idea, edit footage you already have, and add interactive visual content through Hyperframes.",
  applicationName: "Motionhouse",
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${marker.variable} h-full antialiased`}
    >
      {/*
        The standing footer that used to sit here has moved into the landing
        page's own SiteFooter. Keeping both would put two footers under the
        home page, and the studio routes are full-height surfaces that should
        not have anything below them at all.
      */}
      <body className="flex min-h-full flex-col bg-bg text-ink">
        <AuthProvider>
          <StudioProvider>
            <TopBar />
            <main className="flex-1">{children}</main>
          </StudioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
