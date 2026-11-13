"use client"

import { ListOrdered, Plus, RotateCcw, X } from "lucide-react"
import type { Race } from "@/lib/types"
import { Avatar, Button, cx } from "./ui"

/** Ranked-choice (IRV) ballot for one race: tap candidates in order of preference. */
export function RankRace({ race, ranking, onChange }: { race: Race; ranking: number[]; onChange: (r: number[]) => void }) {
  const unranked = race.candidates.map((_, i) => i).filter((i) => !ranking.includes(i))
  return (
    <fieldset className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
      <legend className="sr-only">{race.title}</legend>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold" aria-hidden>
          {race.title}
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent">
            <ListOrdered className="size-3.5" /> Ranked choice
          </span>
        </h2>
        <span className="text-xs text-muted">Tap candidates in your order of preference. Rank as many as you like.</span>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Your ranking</p>
          {ranking.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
              Nothing ranked yet. Leaving this empty counts as a blank vote for this post.
            </p>
          ) : (
            <ol className="space-y-2" aria-label={`${race.title} ranking`}>
              {ranking.map((ci, pos) => (
                <li key={ci} className="flex items-center gap-3 rounded-xl border border-brand bg-brand-50 px-3 py-2.5">
                  <span className="grid size-7 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">{pos + 1}</span>
                  <Avatar name={race.candidates[ci]!.name} size="sm" />
                  <span className="flex-1 font-medium">{race.candidates[ci]!.name}</span>
                  <button
                    type="button"
                    onClick={() => onChange(ranking.filter((x) => x !== ci))}
                    className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-bad"
                    aria-label={`Remove ${race.candidates[ci]!.name}`}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {ranking.length > 0 && (
            <Button type="button" variant="ghost" size="sm" icon={RotateCcw} className="mt-2" onClick={() => onChange([])}>
              Clear ranking
            </Button>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Candidates</p>
          <div className="grid gap-2">
            {unranked.map((ci) => (
              <button
                key={ci}
                type="button"
                onClick={() => onChange([...ranking, ci])}
                className={cx(
                  "flex min-h-12 items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 py-2 text-left transition hover:border-brand/60",
                )}
                aria-label={`Rank ${race.candidates[ci]!.name}`}
              >
                <Avatar name={race.candidates[ci]!.name} size="sm" />
                <span className="flex-1 font-medium">{race.candidates[ci]!.name}</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
                  <Plus className="size-3.5" /> #{ranking.length + 1}
                </span>
              </button>
            ))}
            {unranked.length === 0 && <p className="text-sm text-muted">Everyone is ranked.</p>}
          </div>
        </div>
      </div>
    </fieldset>
  )
}
