import type { NextConfig } from "next"

const API_URL = process.env.SECVOTE_API_URL ?? "http://127.0.0.1:8000"
const PROD = process.env.NODE_ENV === "production"

/** Origins the browser itself talks to: the chain RPC (voters check the roll against the chain) and, unless the
 * proving files are served by this site, their default public host. */
function connectSources(): string {
  const out = ["'self'"]
  try {
    out.push(new URL(process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545").origin)
  } catch {
    /* invalid URL: the app reports it at runtime */
  }
  if (!process.env.NEXT_PUBLIC_SNARK_ARTIFACTS_URL) out.push("https://snark-artifacts.pse.dev")
  return out.join(" ")
}

// Voting keys live in the browser, so injected script is the main threat: allow only this site's own code.
// ('unsafe-inline' is needed for Next.js's inline bootstrap scripts; 'wasm-unsafe-eval' for the proof's WebAssembly.)
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSources()}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Production only: the development server needs eval for hot reloading. Browsers ignore HSTS over plain http.
  ...(PROD
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ]
    : []),
]

const config: NextConfig = {
  // Separate build dir lets the e2e stack run next to a developer's `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@secvote/shared"],
  // Proxy /api/* to FastAPI so session cookies stay first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }]
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default config
