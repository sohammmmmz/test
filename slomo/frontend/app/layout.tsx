import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { CanopyBackdrop } from "@/components/CanopyBackdrop";
import { NavLinks } from "@/components/NavLinks";
import { Providers } from "@/components/Providers";
import { SlothAvatar } from "@/components/SlothAvatar";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "SloMo — Jetson Command Center",
  description: "Virtual pet & command center for the Jetson Orion Nano",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans min-h-screen">
        <Providers>
          <CanopyBackdrop />
          {/* the branch: SloMo hangs from it, nav grows along it */}
          <header className="sticky top-0 z-30 border-b-4 border-canopy-700 bg-bark-900/80 backdrop-blur-md">
            <div className="mx-auto max-w-6xl px-4 flex items-start justify-between">
              <div className="flex items-start gap-8">
                <Link href="/health" className="py-3 font-display text-xl text-cream-100">
                  SloMo
                </Link>
                <NavLinks />
              </div>
              <SlothAvatar />
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
