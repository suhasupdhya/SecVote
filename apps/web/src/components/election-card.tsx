"use client"

import Link from "next/link"
import { ArrowRight, Building2, CalendarClock, ListOrdered, Lock, Trophy } from "lucide-react"
import type { Election, Phase } from "@/lib/types"
import { PhaseBadge, cx, fmtDate } from "./ui"

export function nextMilestone(e: Election): { label: string; at: string } | null {
  const map: Partial<Record<Phase, { label: string; at: string }>> = {
    pending: { label: "Registration opens", at: e.reg_start },
    registration: { label: "Registration closes", at: e.reg_end },
    awaiting_vote: { label: "Voting opens", at: e.vote_start },
    voting: { label: "Voting closes", at: e.vote_end },
  }
  return e.phase ? (map[e.phase] ?? null) : null
}

export const isActive = (e: Election) => e.phase !== "closed"

const EDGE: Record<Phase, string> = {
  pending: "bg-line-strong",
  registration: "bg-brand",
  awaiting_vote: "bg-saffron",
  voting: "bg-ok",
  closed: "bg-line-strong",
}

function action(e: Election): string {
  if (e.phase === "voting") return "Cast your vote"
  if (e.phase === "registration" || e.phase === "pending") return "Register to vote"
  if (e.phase === "awaiting_vote") return "View election"
  return e.chain.result_hash ? "View results" : "Results coming soon"
}

/** A plain-language notice for one election: who, what, the next date that matters, and one action. */
export function ElectionCard({ e }: { e: Election }) {
  const m = nextMilestone(e)
  const posts = e.races.map((r) => r.title)
  const ranked = e.races.some((r) => r.method === "irv")
  return (
    <Link
      href={`/elections/${e.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)] transition duration-200 hover:border-brand hover:shadow-[var(--shadow-lift)]"
    >
      <span className={cx("h-1.5", e.phase ? EDGE[e.phase] : "bg-line-strong")} aria-hidden />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <Building2 className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{e.org}</span>
          </p>
          <PhaseBadge phase={e.phase} />
        </div>
        <h3 className="mt-3 text-xl font-bold leading-snug tracking-tight group-hover:text-brand">{e.title}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm text-muted">
          {e.description || `Election for ${posts.slice(0, 3).join(", ")}${posts.length > 3 ? ` and ${posts.length - 3} more` : ""}.`}
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {e.mode === "sealed" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-1 text-xs font-medium text-ink-2">
              <Lock className="size-3" aria-hidden /> Sealed ballot
            </span>
          )}
          {ranked && (
            <span className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-1 text-xs font-medium text-ink-2">
              <ListOrdered className="size-3" aria-hidden /> Ranked choice
            </span>
          )}
          <span className="inline-flex items-center rounded-md bg-subtle px-2 py-1 text-xs font-medium text-ink-2">
            {posts.length} post{posts.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-auto pt-5">
          <div className="flex items-center gap-2.5 rounded-lg bg-subtle px-3 py-2.5 text-sm">
            {m ? (
              <>
                <CalendarClock className="size-4 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="text-muted">{m.label}: </span>
                  <span className="font-semibold">{fmtDate(m.at)}</span>
                </span>
              </>
            ) : (
              <>
                <Trophy className="size-4 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="text-muted">Voting closed: </span>
                  <span className="font-semibold">{fmtDate(e.vote_end)}</span>
                </span>
              </>
            )}
          </div>
          <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
            {action(e)} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
          </p>
        </div>
      </div>
    </Link>
  )
}
