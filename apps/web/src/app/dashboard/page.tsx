"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Ticket,
  Trash2,
  Trophy,
  UserCheck,
  UserPlus,
  Vote,
  XCircle,
} from "lucide-react"
import { get } from "@/lib/api"
import type { Election, Registration } from "@/lib/types"
import { RequireAuth, isStaff, useMe } from "@/components/providers"
import { ElectionCard } from "@/components/election-card"
import { clearReceipts, loadReceipts, type SavedReceipt } from "@/lib/receipts"
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  HashChip,
  PhaseBadge,
  Skeleton,
  Stat,
  Stepper,
  cx,
  fmtDate,
  type Icon,
  type Tone,
} from "@/components/ui"

type Action = { key: string; icon: Icon; tone: Tone; title: string; detail: string; href: string; cta: string; primary?: boolean }

const STEP: Record<Registration["status"], number> = {
  pending_review: 1,
  rejected: 1,
  approved: 2,
  commitment_submitted: 3,
  enrolled: 4,
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

function Dashboard() {
  const { data: me } = useMe()
  const regs = useQuery({
    queryKey: ["my-registrations"],
    queryFn: () => get<{ items: Registration[] }>("/me/registrations"),
    refetchInterval: 8_000,
  })
  const elections = useQuery({
    queryKey: ["elections"],
    queryFn: () => get<{ items: Election[] }>("/elections"),
    refetchInterval: 10_000,
  })
  const [receipts, setReceipts] = useState<SavedReceipt[]>([])
  useEffect(() => setReceipts(loadReceipts()), [])

  const mine = regs.data?.items ?? []
  const byId = useMemo(() => new Map((elections.data?.items ?? []).map((e) => [e.id, e])), [elections.data])
  const votedHere = new Set(receipts.map((r) => r.electionId))
  const openToApply = (elections.data?.items ?? []).filter(
    (e) => (e.phase === "pending" || e.phase === "registration") && !mine.some((r) => r.election_id === e.id),
  )

  const actions: Action[] = []
  for (const r of mine) {
    const e = byId.get(r.election_id)
    const title = r.election_title ?? "Election"
    const slug = r.election_slug ?? r.election_id
    const regOpen = r.phase === "pending" || r.phase === "registration"
    if (r.phase === "closed" && r.status === "enrolled" && e?.chain.result_hash)
      actions.push({
        key: r.id + "results",
        icon: Trophy,
        tone: "accent",
        title: `Results are out: ${title}`,
        detail: "Declared on chain by the election office. Check the count yourself.",
        href: `/elections/${slug}/bulletin`,
        cta: "See results",
        primary: true,
      })
    else if (r.phase === "closed" && r.status === "enrolled")
      actions.push({
        key: r.id + "pending",
        icon: Clock,
        tone: "neutral",
        title: `Voting closed: ${title}`,
        detail: "The election office will publish the result soon.",
        href: `/elections/${slug}`,
        cta: "View",
      })
    else if (r.status === "enrolled" && r.phase === "voting" && !votedHere.has(r.election_id))
      actions.push({
        key: r.id + "vote",
        icon: Vote,
        tone: "ok",
        title: `Voting is open: ${title}`,
        detail: e ? `Closes ${fmtDate(e.vote_end)}` : "Cast your ballot before voting closes.",
        href: `/elections/${slug}/vote`,
        cta: "Vote now",
        primary: true,
      })
    else if (r.reset_status === "approved" && !r.replacing && regOpen)
      actions.push({
        key: r.id + "reset",
        icon: KeyRound,
        tone: "warn",
        title: `Create your new voting identity: ${title}`,
        detail: e ? `Your passphrase reset was approved. Finish before ${fmtDate(e.reg_end)}.` : "Your passphrase reset was approved.",
        href: `/elections/${slug}/register`,
        cta: "Continue",
        primary: true,
      })
    else if (r.status === "approved" && regOpen)
      actions.push({
        key: r.id + "id",
        icon: KeyRound,
        tone: "warn",
        title: `Create your voting identity: ${title}`,
        detail: e ? `You're approved. Do this before ${fmtDate(e.reg_end)} or you can't vote.` : "You're approved. Finish setting up.",
        href: `/elections/${slug}/register`,
        cta: "Set up now",
        primary: true,
      })
    else if (r.status === "approved" && (r.phase === "awaiting_vote" || r.phase === "voting"))
      actions.push({
        key: r.id + "missed",
        icon: XCircle,
        tone: "bad",
        title: `Not on the voter roll: ${title}`,
        detail: "Registration closed before you created your voting identity, so you can't vote in this election.",
        href: `/elections/${slug}/register`,
        cta: "Details",
      })
    else if (r.status === "pending_review")
      actions.push({ key: r.id, icon: Clock, tone: "brand", title: `Under review: ${title}`, detail: "An official will check your ID card.", href: `/elections/${slug}/register`, cta: "View" })
    else if (r.status === "commitment_submitted")
      actions.push({ key: r.id, icon: ListChecks, tone: "accent", title: `Joining the roll: ${title}`, detail: "Your fingerprint is being added on chain.", href: `/elections/${slug}/register`, cta: "View" })
    else if (r.status === "rejected" && r.can_reapply && regOpen)
      actions.push({
        key: r.id,
        icon: XCircle,
        tone: "bad",
        title: `Not approved: ${title}`,
        detail: `${r.reject_reason ?? "See the reason."} You can apply once more.`,
        href: `/elections/${slug}/register`,
        cta: "Apply again",
        primary: true,
      })
    else if (r.status === "rejected")
      actions.push({ key: r.id, icon: XCircle, tone: "bad", title: `Not approved: ${title}`, detail: r.reject_reason ?? "Contact your election office.", href: `/elections/${slug}/register`, cta: "Details" })
  }
  for (const e of openToApply.slice(0, 3))
    actions.push({
      key: e.id + "apply",
      icon: UserPlus,
      tone: "brand",
      title: `Registration open: ${e.title}`,
      detail: `Apply before ${fmtDate(e.reg_end)}`,
      href: `/elections/${e.slug}/register`,
      cta: "Apply",
    })
  actions.sort((a, b) => Number(!!b.primary) - Number(!!a.primary))

  const firstName = me?.name.split(" ")[0] ?? ""
  const enrolled = mine.filter((r) => r.status === "enrolled").length
  const canVote = mine.filter((r) => r.status === "enrolled" && r.phase === "voting").length

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------ header */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-hero">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-6 p-6 sm:p-10">
          <div className="animate-fade-up space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
              <LayoutDashboard className="size-4" aria-hidden /> Voter dashboard
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {greeting()}, {firstName}
            </h1>
            <p className="max-w-xl text-ink-2">
              {canVote > 0
                ? `You can vote in ${canVote} election${canVote === 1 ? "" : "s"} right now.`
                : actions.some((a) => a.primary)
                  ? "You have something to finish. See below."
                  : "You're all caught up."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/elections" icon={Vote}>
              Browse elections
            </ButtonLink>
            {isStaff(me) && (
              <ButtonLink href="/admin" variant="secondary" icon={LayoutDashboard}>
                Admin console
              </ButtonLink>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="My registrations" value={mine.length} icon={ListChecks} />
        <Stat label="On the voter roll" value={enrolled} icon={UserCheck} tone="accent" />
        <Stat label="Open to vote now" value={canVote} icon={Vote} tone="ok" />
        <Stat label="Receipts on this device" value={receipts.length} icon={Ticket} tone="neutral" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-8">
          {/* ------------------------------------------------------------ actions */}
          <Card title="Action needed" icon={BellRing} description="What to do next across your elections." padded={false}>
            {regs.isLoading || elections.isLoading ? (
              <div className="p-5">
                <Skeleton className="h-28" />
              </div>
            ) : actions.length === 0 ? (
              <div className="flex items-center gap-3 border-t border-line px-5 py-6 text-sm text-muted">
                <CheckCircle2 className="size-5 text-ok" aria-hidden /> Nothing to do right now.
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {actions.map((a) => {
                  const I = a.icon
                  return (
                    <li key={a.key} className={cx("flex flex-wrap items-center gap-4 px-5 py-4", a.primary && "bg-subtle/50")}>
                      <span
                        className={cx(
                          "grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
                          { ok: "bg-ok-50 text-ok ring-ok/25", warn: "bg-warn-50 text-warn ring-warn/25", brand: "bg-brand-50 text-brand ring-brand/25", accent: "bg-accent-50 text-accent ring-accent/25", bad: "bg-bad-50 text-bad ring-bad/25", neutral: "bg-subtle text-muted ring-line" }[a.tone],
                        )}
                      >
                        <I className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{a.title}</p>
                        <p className="text-sm text-muted">{a.detail}</p>
                      </div>
                      <ButtonLink href={a.href} size="sm" variant={a.primary ? "primary" : "secondary"} iconRight={ArrowRight}>
                        {a.cta}
                      </ButtonLink>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------------------ my elections */}
          <section className="space-y-4" aria-labelledby="my-el">
            <div className="flex items-end justify-between">
              <h2 id="my-el" className="text-xl font-bold tracking-tight">
                My elections
              </h2>
              <Link href="/me" className="text-sm font-semibold text-brand hover:underline">
                Account & all registrations →
              </Link>
            </div>
            {regs.isLoading ? (
              <Skeleton className="h-40" />
            ) : mine.length === 0 ? (
              <EmptyState icon={Vote} title="You haven't registered for any election" action={<ButtonLink href="/elections">Find an election</ButtonLink>}>
                Elections open for registration are listed on the home page.
              </EmptyState>
            ) : (
              <ul className="space-y-4">
                {mine.map((r) => (
                  <li key={r.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <Link href={`/elections/${r.election_slug}`} className="text-lg font-semibold tracking-tight hover:text-brand">
                          {r.election_title}
                        </Link>
                        <div className="flex gap-2">
                          <PhaseBadge phase={r.phase ?? null} />
                          {votedHere.has(r.election_id) && (
                            <Badge tone="ok" dot>
                              Voted on this device
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="mt-5">
                        <Stepper steps={["Apply", "Review", "Identity", "On the roll"]} current={STEP[r.status]} />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          {/* ------------------------------------------------------------ receipts */}
          <Card
            title="My ballot receipts"
            icon={Ticket}
            description="Stored only in this browser, never sent to the server."
            action={
              receipts.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => {
                    if (confirm("Remove saved receipts from this browser? Your ballots are not affected.")) {
                      clearReceipts()
                      setReceipts([])
                    }
                  }}
                >
                  Clear
                </Button>
              ) : undefined
            }
          >
            {receipts.length === 0 ? (
              <p className="text-sm text-muted">After you vote, your receipt appears here so you can check it landed on the bulletin board.</p>
            ) : (
              <ul className="space-y-3">
                {receipts.map((r) => (
                  <li key={r.ballotId} className="rounded-xl border border-line p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.electionTitle}</p>
                        <p className="text-xs text-muted">{fmtDate(r.at)}</p>
                      </div>
                      <ButtonLink href={`/track/${r.ballotId}`} size="sm" variant="soft">
                        Track
                      </ButtonLink>
                    </div>
                    <div className="mt-2">
                      <HashChip value={r.nullifier} n={10} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------------------ open elections */}
          {openToApply.length > 0 && (
            <section className="space-y-4" aria-labelledby="open-reg">
              <h2 id="open-reg" className="text-lg font-bold tracking-tight">
                Open for registration
              </h2>
              <ul className="space-y-4">
                {openToApply.map((e) => (
                  <li key={e.id}>
                    <ElectionCard e={e} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Alert tone="accent" title="Your privacy">
            Your dashboard knows which elections you registered for, but nobody, including SecVote, can see how you voted.
          </Alert>
        </aside>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <RequireAuth voter>
      <Dashboard />
    </RequireAuth>
  )
}
