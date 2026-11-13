"use client"

import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Blocks, CheckCircle2, Circle, Clock, Loader2, ScrollText, Send, Ticket, XCircle } from "lucide-react"
import type { BallotStatus } from "@/lib/types"
import { Alert, ButtonLink, Card, HashChip, PageHeader, PageLoader, cx, type Icon } from "@/components/ui"

export default function TrackPage() {
  const { ballotId } = useParams<{ ballotId: string }>()
  const { data, isLoading, error } = useQuery({
    queryKey: ["track", ballotId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/ballots/${encodeURIComponent(ballotId)}`, { credentials: "omit", cache: "no-store" })
      if (!res.ok) throw new Error(res.status === 404 ? "Unknown receipt ID" : "Could not load status")
      return (await res.json()) as BallotStatus
    },
    refetchInterval: (q) => (q.state.data?.on_bulletin || q.state.data?.status === "failed" ? false : 2_000),
  })

  if (isLoading) return <PageLoader />
  if (error || !data) return <Alert tone="bad" title="Receipt not found">{error?.message}</Alert>

  const failed = data.status === "failed"
  const reached = data.on_bulletin ? 4 : data.status === "confirmed" ? 3 : data.status === "sent" ? 2 : 1
  const steps: { label: string; d: string; icon: Icon }[] = [
    { label: "Received by relay", d: "Accepted anonymously, with no login attached.", icon: Ticket },
    { label: "Sent to chain", d: "Transaction broadcast by the relayer.", icon: Send },
    { label: "Recorded on chain", d: "Mined and verified by the Election contract.", icon: Blocks },
    { label: "Published", d: "Indexed onto the public bulletin board.", icon: ScrollText },
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Ballot tracker" title="Where is my ballot?" description="Your receipt shows where your ballot is. It never shows who you are." />

      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
        <Card
          title={failed ? "Ballot failed" : data.on_bulletin ? "On the bulletin board" : "In progress"}
          icon={failed ? XCircle : data.on_bulletin ? CheckCircle2 : Clock}
        >
          {failed ? (
            <Alert tone="bad" title="Failed">
              {data.error}
            </Alert>
          ) : (
            <ol className="space-y-1">
              {steps.map((s, i) => {
                const done = i < reached
                const now = i === reached
                const I = s.icon
                return (
                  <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
                    {i < steps.length - 1 && (
                      <span className={cx("absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-0.5 rounded", done ? "bg-ok" : "bg-line-strong")} aria-hidden />
                    )}
                    <span
                      className={cx(
                        "relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-inset",
                        done ? "bg-ok text-white ring-ok" : now ? "bg-brand-50 text-brand ring-brand" : "bg-surface text-muted ring-line-strong",
                      )}
                    >
                      {done ? <CheckCircle2 className="size-4" /> : now ? <Loader2 className="size-4 animate-spin" /> : <Circle className="size-3.5" />}
                    </span>
                    <div>
                      <p className={cx("flex items-center gap-1.5 text-sm font-semibold", !done && !now && "text-muted")}>
                        <I className="size-3.5" aria-hidden /> {s.label}
                      </p>
                      <p className="text-xs text-muted">{s.d}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </Card>

        <Card title="Receipt details" icon={Ticket}>
          <dl className="space-y-4 text-sm">
            {[
              ["Receipt ID", data.ballot_id],
              ["Nullifier", data.nullifier],
              ["Transaction", data.tx_hash],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</dt>
                <dd className="mt-1">
                  <HashChip value={v} n={12} />
                </dd>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-subtle p-3">
                <dt className="text-xs text-muted">Block</dt>
                <dd className="text-lg font-bold tabular-nums">{data.block_number ?? "—"}</dd>
              </div>
              <div className="rounded-xl bg-subtle p-3">
                <dt className="text-xs text-muted">Bulletin index</dt>
                <dd className="text-lg font-bold tabular-nums">{data.index ?? "—"}</dd>
              </div>
            </div>
          </dl>
          <div className="mt-6">
            <ButtonLink variant="secondary" href={`/elections/${data.election_id}/bulletin`} icon={ScrollText} className="w-full">
              Open bulletin board
            </ButtonLink>
          </div>
        </Card>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Your nullifier is computed from your secret, so only you know which row on the public bulletin board is yours.
      </p>
    </div>
  )
}
