"use client"

import Link from "next/link"
import { Logo } from "./brand"
import { homeFor, isStaff, useMe } from "./providers"

/** Footer links follow the signed-in role, like the header. */
export function Footer() {
  const { data: me } = useMe()
  const col = "space-y-2.5 text-sm text-white/75"
  const link = "transition hover:text-white hover:underline"
  const staff = isStaff(me)
  const quick: [string, string][] = !me
    ? [
        ["/signup", "Register as a voter"],
        ["/login", "Sign in"],
      ]
    : staff
      ? [
          ["/admin", "Admin console"],
          ["/admin/officials", "Officials and roles"],
          ["/admin/audit", "Audit log"],
        ]
      : [
          ["/dashboard", "My dashboard"],
          ["/elections", "Find an election"],
          ...(me.roles.includes("trustee") ? ([["/trustee", "Trustee page"]] as [string, string][]) : []),
          ["/me", "My account"],
        ]

  return (
    <footer className="mt-20 bg-navy text-white print:hidden">
      <div className="h-[3px] bg-saffron" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo onDark href={me ? homeFor(me) : "/"} />
          <p className="max-w-sm text-sm text-white/75">
            A secure online voting system for school, college and institutional elections. Every vote is secret, every voter is verified,
            and every result can be independently recounted.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-white">{!me ? "Get started" : staff ? "Election office" : "Your account"}</p>
          <ul className={`mt-4 ${col}`}>
            {quick.map(([href, label]) => (
              <li key={href}>
                <Link className={link} href={href}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-white">Help</p>
          <ul className={`mt-4 ${col}`}>
            <li>
              <Link className={link} href="/help">
                How to vote
              </Link>
            </li>
            <li>
              <Link className={link} href="/help#faq">
                Frequently asked questions
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-white">Safeguards</p>
          <ul className={`mt-4 ${col}`}>
            <li>Secret ballot</li>
            <li>One person, one vote</li>
            <li>Public bulletin board</li>
            <li>No Aadhaar numbers stored</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/60 sm:px-6">
          SecVote · Secure Electronic Voting. Election officials decide who is eligible; SecVote keeps the ballot secret and the count verifiable.
        </p>
      </div>
    </footer>
  )
}
