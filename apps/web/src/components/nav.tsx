"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Gauge, LayoutDashboard, Lock, LogIn, LogOut, Menu, ShieldCheck, Vault, X } from "lucide-react"
import { homeFor, isStaff, useMe, useSignOut } from "./providers"
import { Logo } from "./brand"
import { ThemeToggle } from "./theme-toggle"
import { Avatar, ButtonLink, cx } from "./ui"

export function Nav() {
  const { data: me } = useMe()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const isAdmin = isStaff(me)
  const logout = useSignOut()

  useEffect(() => setOpen(false), [pathname])

  // Each role sees only its own areas. Visitors get the landing page via the logo.
  const links = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: Gauge,
      show: !!me && !isAdmin,
      active: pathname === "/dashboard" || pathname.startsWith("/elections") || pathname.startsWith("/track"),
    },
    { href: "/trustee", label: "Trustee", icon: Vault, show: !!me?.roles.includes("trustee"), active: pathname === "/trustee" },
    { href: "/admin", label: "Admin console", icon: LayoutDashboard, show: isAdmin, active: pathname.startsWith("/admin") },
  ].filter((l) => l.show)
  const role = me?.roles.includes("owner")
    ? "Super admin"
    : me?.roles.includes("admin")
    ? "Election official"
    : me?.roles.includes("officer")
      ? "Election officer"
      : me?.roles.includes("trustee")
        ? "Trustee"
        : "Voter"

  return (
    <>
      {/* Official strip */}
      <div className="bg-navy text-white print:hidden">
        <div className="mx-auto flex h-9 max-w-6xl items-center justify-between gap-4 px-4 text-xs sm:px-6">
          <p className="flex items-center gap-2 truncate font-medium text-white/85">
            <Lock className="size-3.5 shrink-0 text-saffron" aria-hidden />
            <span className="truncate">Official election portal for schools, colleges and public institutions</span>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Link href="/help" className="hidden rounded-md px-2 py-1 font-medium text-white/85 hover:bg-white/10 hover:text-white sm:block">
              Help &amp; how to vote
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="h-[3px] bg-saffron" aria-hidden />
      </div>

      <header className="sticky top-0 z-40 border-b border-line bg-surface shadow-[var(--shadow-card)] print:hidden">
        <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo href={me ? homeFor(me) : "/"} />

          <nav className="hidden h-full items-stretch gap-1 md:flex" aria-label="Main">
            {links.map(({ href, label, icon: I, active }) => (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative inline-flex items-center gap-2 px-3.5 text-sm font-semibold transition",
                  active ? "text-brand" : "text-ink-2 hover:text-brand",
                )}
              >
                <I className="size-4" aria-hidden />
                {label}
                <span className={cx("absolute inset-x-2 bottom-0 h-[3px] rounded-t", active ? "bg-saffron" : "bg-transparent")} aria-hidden />
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {me ? (
              <>
                <Link
                  href="/me"
                  title="Account"
                  className="flex items-center gap-2.5 rounded-lg border border-line py-1 pl-1 pr-3 transition hover:border-brand"
                >
                  <Avatar name={me.name} size="sm" />
                  <span className="leading-tight">
                    <span className="block max-w-36 truncate text-sm font-semibold">{me.name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-muted">
                      {isAdmin && <ShieldCheck className="size-3 text-ok" aria-hidden />}
                      {role}
                    </span>
                  </span>
                </Link>
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 transition hover:bg-subtle hover:text-bad"
                >
                  <LogOut className="size-4" aria-hidden /> Sign out
                </button>
              </>
            ) : (
              <>
                <ButtonLink href="/login" variant="secondary" size="sm" icon={LogIn}>
                  Sign in
                </ButtonLink>
                <ButtonLink href="/signup" size="sm">
                  Register
                </ButtonLink>
              </>
            )}
          </div>

          <button
            className="grid size-10 place-items-center rounded-lg border border-line-strong md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open && (
          <div className="border-t border-line bg-surface px-4 py-3 md:hidden">
            <div className="space-y-1">
              {links.map(({ href, label, icon: I, active }) => (
                <Link
                  key={href}
                  href={href}
                  className={cx(
                    "flex items-center gap-3 rounded-lg border-l-[3px] px-3 py-2.5 text-sm font-semibold",
                    active ? "border-saffron bg-brand-50 text-brand" : "border-transparent text-ink-2",
                  )}
                >
                  <I className="size-4" aria-hidden /> {label}
                </Link>
              ))}
              {me && (
                <Link href="/me" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-2">
                  <Avatar name={me.name} size="sm" /> Account
                </Link>
              )}
              {me ? (
                <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-bad">
                  <LogOut className="size-4" aria-hidden /> Sign out ({me.name})
                </button>
              ) : (
                <div className="flex gap-2 pt-2">
                  <ButtonLink href="/login" variant="secondary" className="flex-1">
                    Sign in
                  </ButtonLink>
                  <ButtonLink href="/signup" className="flex-1">
                    Register
                  </ButtonLink>
                </div>
              )}
            </div>
          </div>
        )}
      </header>
    </>
  )
}
