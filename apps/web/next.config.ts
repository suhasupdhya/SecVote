import type { NextConfig } from "next"

const API_URL = process.env.SECVOTE_API_URL ?? "http://127.0.0.1:8000"

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
