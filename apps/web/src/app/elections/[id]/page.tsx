"use client"

import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  Blocks,
  ClipboardList,
  FileText,
  Layers,
  Lock,
  PauseCircle,
  PieChart,
  ScrollText,
  Settings2,
  Trophy,
  UserCheck,
  UserPlus,
  Vote,
} from "lucide-react"
import { get } from "@/lib/api"
import { useElection, useTurnout } from "@/lib/hooks"
import { isStaff, useMe } from "@/components/providers"
import { nextMilestone } from "@/components/election-card"
import {
  Alert,
  Avatar,
  ButtonLink,
  Card,
  Countdown,
  HashChip,
  PageLoader,
  PhaseBadge,
  ProgressBar,
  Stat,
  cx,
  fmtDate,
  type Icon,
} from "@/components/ui"
import type { Election, Phase, Registration } from "@/lib/types"

const ORDER: Phase[] = ["pending", "registration", "awaiting_vote", "voting", "closed"]

function Timeline({ e }: { e: Election }) {
  const steps: { key: Phase; label: string; when: string; icon: Icon }[] = [
    { key: "registration", label: "Registration", when: `${fmtDate(e.reg_start)}\nto ${fmtDate(e.reg_end)}`, icon: UserPlus },
    {
      key: "awaiting_vote",
      label: "Roll frozen",
      when: e.chain.frozen ? `${e.chain.member_count} voter${e.chain.member_count === 1 ? "" : "s"} locked in` : "Locked when registration closes",
      icon: Lock,
    },
    { key: "voting", label: "Voting", when: `${fmtDate(e.vote_start)}\nto ${fmtDate(e.vote_end)}`, icon: Vote },
    { key: "closed", label: "Results", when: e.chain.result_hash ? "Declared on chain" : "After voting closes", icon: Trophy },
  ]
  const current = e.phase ? ORDER.indexOf(e.phase) : -1
  return (
    <Card title="Timeline" icon={ClipboardList}>
      <ol className="relative grid gap-6 md:grid-cols-4 md:gap-4">
        {steps.map((s, i) => {
          const idx = ORDER.indexOf(s.key)
          const state = idx < current ? "done" : idx === current ? "now" : "next"
          const I = s.icon
          return (
            <li key={s.key} aria-current={state === "now" ? "step" : undefined} className="relative flex gap-3 md:flex-col">
              {i < steps.length - 1 && (
                <span
                  className={cx(
                    "absolute left-5 top-11 h-[calc(100%-1rem)] w-px md:left-11 md:top-5 md:h-px md:w-[calc(100%-2rem)]",
                    state === "done" ? "bg-brand" : "bg-line-strong",
                  )}
                  aria-hidden
                />
              )}
              <span
                className={cx(
                  "relative z-10 grid size-10 shrink-0 place-items-center rounded-full ring-1 ring-inset",
                  state === "done" && "bg-brand text-brand-ink ring-brand",
                  state === "now" && "bg-brand-50 text-brand ring-brand shadow-[var(--shadow-glow)]",
                  state === "next" && "bg-surface text-muted ring-line-strong",
                )}
              >
                <I className="size-4" aria-hidden />
              </span>
              <div>
                <p className={cx("text-sm font-semibold", state === "next" && "text-muted")}>
                  {s.label}
                  {state === "now" && <span className="ml-2 text-xs font-medium text-brand">Now</span>}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{s.when}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

export default function ElectionPage() {
  const { id } = useParams<{ id: string }>()
  const { data: e, isLoading, error } = useElection(id, { poll: 5_000 })
  const { data: turnout } = useTurnout(id)
  const { data: me } = useMe()
  // Only voters on the frozen roll can cast a ballot: don't offer it to anyone else.
  const myRegs = useQuery({
    queryKey: ["my-registrations"],
    queryFn: () => get<{ items: Registration[] }>("/me/registrations"),
    enabled: !!me && !isStaff(me),
  })

  if (isLoading) return <PageLoader />
  if (error || !e) return <Alert tone="bad" title="Election not found">{error?.message}</Alert>

  const m = nextMilestone(e)
  const members = turnout?.members ?? e.chain.member_count
  const ballots = turnout?.ballots ?? e.chain.ballot_count
  const pct = members > 0 ? (ballots / members) * 100 : 0
  const regOpen = e.phase === "pending" || e.phase === "registration"
  const staff = isStaff(me)
  const myReg = myRegs.data?.items.find((r) => r.election_id === e.id)

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-hero">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div className="animate-fade-up space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <PhaseBadge phase={e.phase} />
              {e.high_stakes && <span className="rounded-full bg-surface/80 px-2.5 py-1 text-xs font-semibold ring-1 ring-line">Two-person approval</span>}
              {e.mode === "sealed" && (
                <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/25">
                  Sealed ballots · counted after close
                </span>
              )}
              {e.chain.paused && (
                <span className="inline-flex items-center gap-1 rounded-full bg-bad-50 px-2.5 py-1 text-xs font-semibold text-bad">
                  <PauseCircle className="size-3.5" /> Paused by the election officer
                </span>
              )}
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">{e.org}</p>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{e.title}</h1>
            {e.description && <p className="max-w-2xl text-ink-2">{e.description}</p>}
            <div className="flex flex-wrap gap-3 pt-2">
              {staff && (
                <ButtonLink href={`/admin/elections/${e.id}`} size="lg" icon={Settings2}>
                  Manage in admin console
                </ButtonLink>
              )}
              {!staff && regOpen &&
                (me ? (
                  <ButtonLink href={`/elections/${e.slug}/register`} size="lg" icon={UserPlus}>
                    Register to vote
                  </ButtonLink>
                ) : (
                  <ButtonLink href={`/login?next=/elections/${e.slug}/register`} size="lg" icon={UserPlus}>
                    Sign in to register
                  </ButtonLink>
                ))}
              {!staff && e.phase === "voting" && (!me || myReg?.status === "enrolled") && (
                <ButtonLink href={`/elections/${e.slug}/vote`} size="lg" icon={Vote}>
                  Cast your ballot
                </ButtonLink>
              )}
              {!staff && me && e.phase === "voting" && myRegs.isSuccess && myReg?.status !== "enrolled" && (
                <span className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-subtle px-5 text-sm font-semibold text-ink-2 ring-1 ring-inset ring-line">
                  <Lock className="size-4" aria-hidden />
                  {myReg ? "You're not on the voter roll for this election" : "You didn't register for this election"}
                </span>
              )}
              {e.phase === "closed" && e.chain.result_hash ? (
                <ButtonLink size="lg" href={`/elections/${e.slug}/bulletin`} icon={Trophy}>
                  See final results
                </ButtonLink>
              ) : e.phase === "closed" ? (
                <>
                  <span className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-warn-50 px-5 text-sm font-semibold text-warn ring-1 ring-inset ring-warn/25">
                    <Trophy className="size-4" aria-hidden /> Results will be published soon
                  </span>
                  <ButtonLink variant="secondary" size="lg" href={`/elections/${e.slug}/bulletin`} icon={ScrollText}>
                    Bulletin board
                  </ButtonLink>
                </>
              ) : (
                <ButtonLink variant="secondary" size="lg" href={`/elections/${e.slug}/bulletin`} icon={ScrollText}>
                  Bulletin board & results
                </ButtonLink>
              )}
            </div>
          </div>
          {m && (
            <div className="rounded-2xl border border-line bg-surface/80 p-5 shadow-[var(--shadow-card)] backdrop-blur lg:justify-self-end">
              <Countdown to={m.at} label={m.label} />
              <p className="mt-3 text-xs text-muted">{fmtDate(m.at)}</p>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Registered voters" value={members} icon={UserCheck} sub={e.chain.frozen ? "Roll frozen on chain" : "Roll still open"} />
        <Stat label="Ballots cast" value={ballots} icon={Vote} tone="ok" sub="Counted from on-chain events" />
        <div className="rounded-2xl border border-line border-l-[3px] border-l-brand bg-surface p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Turnout</p>
            <span className="grid size-9 place-items-center rounded-xl bg-accent-50 text-accent ring-1 ring-inset ring-accent/25">
              <PieChart className="size-4" aria-hidden />
            </span>
          </div>
          <p className="font-display mt-2 text-3xl font-bold tabular-nums">{Math.round(pct)}%</p>
          <div className="mt-3">
            <ProgressBar value={pct} tone="accent" label="Turnout" />
          </div>
        </div>
        <Stat label="Posts" value={e.races.length} icon={Layers} tone="accent" sub={e.allow_nota ? "NOTA available" : "No NOTA option"} />
      </div>

      <Timeline e={e} />

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        {/* ------------------------------------------------------------ races */}
        <section className="space-y-5" aria-labelledby="races">
          <h2 id="races" className="text-xl font-bold tracking-tight">
            Posts and candidates
          </h2>
          {e.races.map((r) => (
            <Card key={r.id} title={r.title} description={`${r.candidates.length} candidate${r.candidates.length === 1 ? "" : "s"} · ${r.method === "irv" ? "ranked choice" : "pick one"}`}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {r.candidates.map((c) => (
                  <li key={c.id} className="rounded-xl border border-line bg-subtle/50 p-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.name} />
                      <p className="font-semibold">{c.name}</p>
                    </div>
                    {c.manifesto && (
                      <details className="group mt-3">
                        <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-brand">
                          <FileText className="size-3.5" aria-hidden /> Read manifesto
                        </summary>
                        <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{c.manifesto}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </section>

        {/* ------------------------------------------------------------ chain facts */}
        <aside className="space-y-5">
          <Card title="On the blockchain" icon={Blocks} description="Anyone can check these values against the contract.">
            <dl className="space-y-4 text-sm">
              {[
                ["Contract", e.chain.address],
                ["Election scope", e.chain.scope],
                ["Frozen roll root", e.chain.frozen ? e.chain.frozen_root : null],
                ["Declared result", e.chain.result_hash],
              ].map(([k, v]) => (
                <div key={k} className="space-y-1">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</dt>
                  <dd>
                    {v ? (
                      <HashChip value={v} n={12} />
                    ) : (
                      <span className="text-muted">{k === "Contract" ? "Deploying…" : k === "Frozen roll root" ? "Not frozen yet" : "Not yet"}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
          <Alert tone="accent" title="Why no reminders?">
            SecVote can&apos;t tell who has voted, so it can&apos;t send &ldquo;you haven&apos;t voted yet&rdquo; reminders. That&apos;s
            deliberate.
          </Alert>
        </aside>
      </div>
    </div>
  )
}
