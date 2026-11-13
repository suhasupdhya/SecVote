"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookUser, ListChecks, ScrollText, UsersRound } from "lucide-react"
import { cx } from "./ui"

const TABS = [
  { href: "/admin", label: "Elections", icon: ListChecks, match: (p: string) => p === "/admin" || p.startsWith("/admin/elections") },
  { href: "/admin/register", label: "Voter register", icon: BookUser, match: (p: string) => p.startsWith("/admin/register") },
  { href: "/admin/officials", label: "Officials", icon: UsersRound, match: (p: string) => p.startsWith("/admin/officials") },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, match: (p: string) => p.startsWith("/admin/audit") },
]

/** Sub-menu shared by every admin page. */
export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Admin sections" className="-mt-4 mb-8 flex flex-wrap gap-1 border-b border-line">
      {TABS.map(({ href, label, icon: I, match }) => {
        const active = match(pathname)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "-mb-px inline-flex items-center gap-2 border-b-[3px] px-4 py-2.5 text-sm font-semibold transition",
              active ? "border-saffron text-brand" : "border-transparent text-ink-2 hover:text-brand",
            )}
          >
            <I className="size-4" aria-hidden /> {label}
          </Link>
        )
      })}
    </nav>
  )
}
