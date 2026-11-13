// Next 16 proxy (formerly middleware). UX redirects ONLY — never a security check.
// The API checks the session and role on every request itself.
import { NextResponse, type NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  if (!request.cookies.has("sv_session")) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = { matcher: ["/admin/:path*", "/me", "/dashboard", "/trustee"] }
