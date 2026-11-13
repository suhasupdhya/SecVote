import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Public_Sans, Source_Serif_4 } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"
import { Nav } from "@/components/nav"
import { Footer } from "@/components/footer"

const sans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" })
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" })

export const metadata: Metadata = {
  title: { default: "SecVote: Secure Electronic Voting", template: "%s · SecVote" },
  description: "Secret, verifiable online elections for schools, colleges and public institutions.",
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1f44" }

// Applies the saved theme before first paint (light unless the voter chose dark on this device).
const THEME_SCRIPT = `try{var t=localStorage.getItem("secvote:theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <Providers>
          <Nav />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
