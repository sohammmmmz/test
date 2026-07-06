import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SlothAvatar } from "@/components/SlothAvatar";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "SloMo — Jetson Command Center",
  description: "Virtual pet & command center for the Jetson Orion Nano",
};

const NAV = [
  { href: "/health", label: "Health" },
  { href: "/chat", label: "Chat" },
  { href: "/workspace", label: "Workspace" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans min-h-screen">
        <Providers>
          {/* the branch: SloMo hangs from it, nav grows along it */}
          <header className="sticky top-0 z-30 border-b-4 border-canopy-700 bg-bark-900/95 backdrop-blur">
            <div className="mx-auto max-w-6xl px-4 flex items-start justify-between">
              <div className="flex items-start gap-8">
                <Link href="/health" className="py-3 font-display text-xl text-cream-100">
                  SloMo
                </Link>
                <nav className="flex gap-1 py-2" aria-label="Main">
                  {NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="px-3 py-1.5 rounded-lg text-sm text-cream-300 hover:text-cream-100 hover:bg-canopy-800 transition-colors duration-300 ease-sloth"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
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
