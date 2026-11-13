"use client"

import { useParams } from "next/navigation"
import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { BadgeCheck, ChevronLeft, ChevronRight, Crown, Download, Printer, EyeOff, Hash, Inbox, Lock, ScrollText, ShieldAlert, Trophy, Vote } from "lucide-react"
import { get } from "@/lib/api"
import { useElection, useResults } from "@/lib/hooks"
import type { Election, Results } from "@/lib/types"
import { isStaff, useMe } from "@/components/providers"
import {
  Alert,
  Avatar,
  Button,
  ButtonLink,
  Badge,
  Card,
  EmptyState,
  HashChip,
  PageHeader,
  PageLoader,
  PhaseBadge,
  ProgressBar,
  Skeleton,
  Stat,
  cx,
  fmtDate,
} from "@/components/ui"

type RaceResult = NonNullable<Results["races"]>[number]

/** Why a post has no winner: nobody voted for a candidate, or two or more candidates are level on top. */
function NoWinner({ race, published }: { race: RaceResult; published: boolean }) {
  const votes = race.method === "irv" && race.rounds?.length ? race.rounds[race.rounds.length - 1]!.counts : race.candidates.map((c) => c.votes)
  const top = Math.max(0, ...votes)
  const level = race.candidates.filter((_, i) => top > 0 && votes[i] === top).map((c) => c.name)
  const text =
    top === 0
      ? "No candidate received a vote, so there is no winner for this post."
      : `${level.join(" and ")} are tied with ${top} vote${top === 1 ? "" : "s"} each${published ? ", so there is no single winner under the counting rules" : ""}.`
  return <p className="mt-4 rounded-lg bg-warn-50 px-3 py-2 text-xs font-medium text-warn">{text}</p>
}

const PAGE = 100

type Row = { name: string; votes: number; kind: "cand" | "other"; idx: number }

/** The lines shown for one post: candidates, then NOTA / exhausted / blank / invalid. */
function raceRows(race: RaceResult, allowNota: boolean): Row[] {
  const irv = race.method === "irv"
  return [
    ...race.candidates.map((c, idx) => ({ name: c.name, votes: c.votes, kind: "cand" as const, idx })),
    ...(allowNota && !irv ? [{ name: "NOTA", votes: race.nota, kind: "other" as const, idx: -2 }] : []),
    ...(irv && race.rounds?.length ? [{ name: "Exhausted", votes: race.rounds[race.rounds.length - 1]!.exhausted, kind: "other" as const, idx: -3 }] : []),
    { name: "Blank", votes: race.abstain, kind: "other" as const, idx: -4 },
    ...(race.invalid ? [{ name: "Invalid", votes: race.invalid, kind: "other" as const, idx: -5 }] : []),
  ]
}

/** The declared result as a CSV file the election office can keep or attach to a notice. */
function downloadCsv(e: Election, r: Results) {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [
    [q("Election"), q(e.title)],
    [q("Organisation"), q(e.org)],
    [q("Voting closed"), q(new Date(e.vote_end).toISOString())],
    [q("Declared result hash"), q(r.declared_hash ?? "")],
    [],
    [q("Post"), q("Option"), q("Votes"), q("Share %"), q("Result")],
  ]
  for (const race of r.races ?? []) {
    const rows = raceRows(race, e.allow_nota)
    const total = rows.reduce((s, x) => s + x.votes, 0)
    for (const row of rows)
      lines.push([
        q(race.title),
        q(row.name),
        q(row.votes),
        q(total ? ((row.votes / total) * 100).toFixed(1) : "0.0"),
        q(row.kind === "cand" && row.idx === race.winner ? "Winner" : ""),
      ])
  }
  const blob = new Blob([lines.map((l) => l.join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${e.slug}-results.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

type BulletinItem = { index: number; nullifier: string; ballot: string; tx_hash: string; block_number: number; block_time: string }

export default function BulletinPage() {
  const { id } = useParams<{ id: string }>()
  const { data: e, isLoading, error } = useElection(id)
  const { data: me } = useMe()
  const official = isStaff(me)
  const results = useResults(id, 5_000, official)
  const [page, setPage] = useState(0)
  const bulletin = useQuery({
    queryKey: ["bulletin", id, page],
    queryFn: () => get<{ total: number; items: BulletinItem[] }>(`/elections/${id}/ballots?skip=${page * PAGE}&limit=${PAGE}`),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  })
  const total = bulletin.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))

  if (isLoading) return <PageLoader />
  if (error || !e) return <Alert tone="bad" title="Election not found">{error?.message}</Alert>
  const r = results.data
  const declared = !!r?.published
  const hashOk = declared && r!.declared_hash === r!.computed_hash
  const preview = !!r?.preview
  const bannerTitle = declared
    ? hashOk
      ? "Matches declared result"
      : "Does not match declared result"
    : preview
      ? "Private preview: not published yet"
      : e.phase === "closed"
        ? "Voting has closed: results coming soon"
        : "Results will be published after voting closes"
  const bannerText = declared
    ? "We recomputed the tally from every on-chain ballot and compared its hash with the one the officer declared on chain."
    : preview
      ? "Only election officials can see this count. Voters see it once you declare the result."
      : "The election office publishes the result once voting has closed. Until then, the count stays hidden; you can still check your ballot was recorded below."

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: `/elections/${e.slug}`, label: e.title }}
        eyebrow={e.org}
        title="Bulletin board & results"
        description="Every ballot exactly as it landed on chain. Each nullifier proves one vote per voter without revealing who cast it."
        badges={<PhaseBadge phase={e.phase} />}
        actions={
          r?.published && r.races ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button variant="secondary" icon={Download} onClick={() => downloadCsv(e, r)}>
                Download CSV
              </Button>
              <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
                Print or save PDF
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* ------------------------------------------------------------ verification banner */}
      <section
        className={cx(
          "flex flex-wrap items-center gap-4 rounded-2xl p-5 ring-1 ring-inset sm:p-6",
          !declared && !preview && "bg-brand-50 ring-brand/20",
          preview && "bg-warn-50 ring-warn/25",
          declared && hashOk && "bg-ok-50 ring-ok/25",
          declared && !hashOk && "bg-bad-50 ring-bad/25",
        )}
      >
        <span
          className={cx(
            "grid size-12 place-items-center rounded-2xl text-white shadow-md",
            preview ? "bg-warn" : !declared ? "bg-brand" : hashOk ? "bg-ok" : "bg-bad",
          )}
        >
          {preview ? <EyeOff className="size-6" aria-hidden /> : !declared ? <Lock className="size-6" aria-hidden /> : hashOk ? <BadgeCheck className="size-6" aria-hidden /> : <ShieldAlert className="size-6" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{bannerTitle}</p>
          <p className="text-sm text-muted">{bannerText}</p>
        </div>
        {preview && (
          <ButtonLink href={`/admin/elections/${e.id}`} icon={Trophy}>
            Go to declare
          </ButtonLink>
        )}
        {r?.published && (
          <ButtonLink href={`/elections/${e.slug}/verify`} variant="secondary" icon={BadgeCheck}>
            Verify it yourself
          </ButtonLink>
        )}
        {r?.published && (
          <div className="grid gap-1 text-xs">
            <span className="flex items-center gap-2 text-muted">
              Recomputed <HashChip value={r.computed_hash} n={8} />
            </span>
            {r.declared_hash && (
              <span className="flex items-center gap-2 text-muted">
                Declared <HashChip value={r.declared_hash} n={8} />
              </span>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Ballots on the board" value={bulletin.data?.total ?? e.chain.ballot_count} icon={Vote} tone="ok" />
        <Stat label="Registered voters" value={e.chain.member_count} icon={Hash} />
        <Stat
          label="Turnout"
          value={`${e.chain.member_count ? Math.round(((bulletin.data?.total ?? e.chain.ballot_count) / e.chain.member_count) * 100) : 0}%`}
          icon={Trophy}
          tone="accent"
        />
      </div>

      {/* ------------------------------------------------------------ results */}
      <section className="space-y-4" aria-labelledby="results">
        <h2 id="results" className="text-xl font-bold tracking-tight">
          Results
        </h2>
        {!r ? (
          <div className="grid gap-5 md:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : !r.races ? (
          <EmptyState icon={Lock} title="Results aren't published yet">
            {r.awaiting_key && e.phase === "closed"
              ? "Voting has closed. These are sealed ballots: they will be decrypted and counted once two of the three trustees unlock the election key."
              : e.phase === "closed"
              ? "Voting has closed. The election office will publish the verified result here."
              : `The count is hidden while voting is open. ${r.ballots} ballot${r.ballots === 1 ? " has" : "s have"} been cast so far.`}
          </EmptyState>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {r.races.map((race) => {
              const irv = race.method === "irv"
              const rows = raceRows(race, e.allow_nota)
              const total = rows.reduce((s, x) => s + x.votes, 0)
              const top = race.winner ?? -1
              return (
                <Card
                  key={race.race_id}
                  title={race.title}
                  description={
                    irv
                      ? `Ranked choice · ${race.rounds?.length ?? 0} round${race.rounds?.length === 1 ? "" : "s"} · final round shown`
                      : `${total} ballot${total === 1 ? "" : "s"} counted`
                  }
                >
                  <ul className="space-y-4" data-testid={`results-${race.title}`}>
                    {rows.map((row) => {
                      const pct = total ? (row.votes / total) * 100 : 0
                      const leading = row.kind === "cand" && row.idx === top
                      return (
                        <li key={row.name}>
                          <div className="flex items-center gap-3">
                            {row.kind === "cand" ? (
                              <Avatar name={row.name} size="sm" />
                            ) : (
                              <span className="grid size-8 place-items-center rounded-full bg-subtle text-[10px] font-bold text-muted">—</span>
                            )}
                            <span className={cx("flex-1 text-sm", leading ? "font-semibold" : "text-ink-2")}>
                              {row.name}
                              {leading && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-warn">
                                  <Crown className="size-3.5" aria-hidden /> {r.published ? "Winner" : "Leading"}
                                </span>
                              )}
                            </span>
                            <span className="text-sm font-bold tabular-nums">{row.votes}</span>
                            <span className="w-12 text-right text-xs tabular-nums text-muted">{pct.toFixed(0)}%</span>
                          </div>
                          <div className="mt-2 pl-11">
                            <ProgressBar value={pct} tone={leading ? "ok" : "brand"} label={`${row.name} share`} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  {race.winner === -1 && total > 0 && <NoWinner race={race} published={r.published} />}
                  {irv && race.rounds && race.rounds.length > 0 && (
                    <details className="mt-5 rounded-xl border border-line">
                      <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">Round-by-round count</summary>
                      <div className="overflow-x-auto px-4 pb-4">
                        <table className="w-full text-sm">
                          <thead className="text-xs uppercase text-muted">
                            <tr>
                              <th className="py-2 text-left">Candidate</th>
                              {race.rounds.map((_, ri) => (
                                <th key={ri} className="py-2 text-right">
                                  R{ri + 1}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {race.candidates.map((c, ci) => (
                              <tr key={c.id}>
                                <td className="py-1.5">{c.name}</td>
                                {race.rounds!.map((round, ri) => (
                                  <td key={ri} className="py-1.5 text-right tabular-nums">
                                    {round.counts[ci]}
                                  </td>
                                ))}
                              </tr>
                            ))}
                            <tr className="text-muted">
                              <td className="py-1.5">Exhausted</td>
                              {race.rounds.map((round, ri) => (
                                <td key={ri} className="py-1.5 text-right tabular-nums">
                                  {round.exhausted}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                        <p className="mt-2 text-xs text-muted">The candidate with the fewest votes is eliminated each round and their ballots move to the next preference.</p>
                      </div>
                    </details>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ ballots */}
      <Card
        title="Every ballot"
        icon={ScrollText}
        description="Find your nullifier to confirm your ballot was recorded as cast."
        action={<Badge tone="brand">{total} total</Badge>}
        padded={false}
      >
        {bulletin.isLoading ? (
          <div className="p-5">
            <Skeleton className="h-40" />
          </div>
        ) : bulletin.data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-y border-line bg-subtle/70 text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">#</th>
                  <th className="px-5 py-3 font-semibold">Nullifier</th>
                  <th className="px-5 py-3 font-semibold">Block</th>
                  <th className="px-5 py-3 font-semibold">Time</th>
                  <th className="px-5 py-3 font-semibold">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bulletin.data.items.map((b) => (
                  <tr key={b.nullifier} className="transition hover:bg-subtle/50">
                    <td className="px-5 py-3 font-semibold tabular-nums">{b.index}</td>
                    <td className="px-5 py-3">
                      <HashChip value={b.nullifier} n={10} />
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-2">{b.block_number}</td>
                    <td className="px-5 py-3 text-ink-2">{fmtDate(b.block_time)}</td>
                    <td className="px-5 py-3">
                      <HashChip value={b.tx_hash} n={8} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
                <span className="text-muted">
                  Showing {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={Inbox} title="No ballots yet">
              Ballots appear here the moment they land on chain.
            </EmptyState>
          </div>
        )}
      </Card>
    </div>
  )
}
