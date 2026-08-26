import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// Bricolage carries the personality — a grotesque with real width and optical
// axes, deliberately not the neutral UI face every dashboard reaches for.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const body = Public_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
  display: "swap",
});

// Dates, counts, branch names — anything that should line up in a column.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Morning Ledger",
  description: "Plan the day, run the standup, keep GitLab in step.",
};

// The font variables belong on <html>, not <body>: the design tokens in
// globals.css are declared on :root and reference them, and a custom property
// that is undefined at :root makes the whole token resolve to nothing.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        {/* Applied before first paint so a stored choice never flashes the
            wrong ground colour. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=document.documentElement;" +
              "var t=localStorage.getItem('theme');" +
              "if(t&&t!=='system')d.setAttribute('data-theme',t);" +
              // The ambient wash follows the hour. Read here rather than during
              // render so the server and the client cannot disagree about what
              // time it is.
              "var h=new Date().getHours();" +
              "d.setAttribute('data-daypart'," +
              "h<5?'night':h<8?'dawn':h<12?'morning':h<17?'afternoon':h<21?'evening':'night');" +
              "}catch(e){}})()",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
