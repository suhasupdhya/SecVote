"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CheckCircle2, FileText, Layers, ListChecks, Plus, Vote } from "lucide-react"
import { get } from "@/lib/api"
import type { Election } from "@/lib/types"
import { RequireAuth, useMe } from "@/components/providers"
import { AdminNav } from "@/components/admin-nav"
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, PhaseBadge, Skeleton, Stat, fmtDate, type Tone } from "@/components/ui"

/** What the official should do next for each election, in plain words. */
function nextAction(e: Election): { label: string; tone: Tone } {
  if (e.status === "draft") return e.mode === "sealed" && !e.chain.public_key ? { label: "Draft · set up trustees", tone: "warn" } : { label: "Draft · ready to publish", tone: "warn" }
  if (e.status === "failed") return { label: "Publish again", tone: "bad" }
  if (e.status === "deploying") return { label: "Publishing…", tone: "neutral" }
  if (e.phase === "pending") return { label: "Opens soon", tone: "neutral" }
  if (e.phase === "registration") return { label: "Review voters", tone: "brand" }
  if (e.phase === "awaiting_vote") return { label: "Open voting", tone: "brand" }
  if (e.phase === "voting") return { label: "Voting in progress", tone: "ok" }
  if (e.mode === "sealed" && !e.chain.revealed_key) return { label: "Waiting for trustees", tone: "warn" }
  if (!e.chain.result_hash) return { label: "Declare result", tone: "warn" }
  return { label: "Completed", tone: "neutral" }
}

const done = (e: Election) => e.status === "published" && e.phase === "closed" && !!e.chain.result_hash

function ElectionTable({ items, completed = false }: { items: Election[]; completed?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="border-b border-line bg-subtle text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-5 py-3 font-semibold">Election</th>
            <th className="px-5 py-3 font-semibold">{completed ? "Voting closed" : "Voting"}</th>
            <th className="px-5 py-3 text-right font-semibold">Voters</th>
            <th className="px-5 py-3 text-right font-semibold">Ballots</th>
            <th className="px-5 py-3 font-semibold">{completed ? "Turnout" : "Status"}</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((e) => {
            const a = nextAction(e)
            return (
              <tr key={e.id} className="group hover:bg-subtle/60">
                <td className="px-5 py-3.5">
                  <Link href={`/admin/elections/${e.id}`} className="font-semibold group-hover:text-brand">
                    {e.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {e.org} · {e.races.length} post{e.races.length === 1 ? "" : "s"}
                    {e.mode === "sealed" ? " · sealed" : ""}
                  </p>
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 text-ink-2">{completed
                    ? fmtDate(e.vote_end)
                    : e.phase === "voting"
                      ? `Until ${fmtDate(e.vote_end)}`
                      : e.phase === "closed"
                        ? `Closed ${fmtDate(e.vote_end)}`
                        : `From ${fmtDate(e.vote_start)}`}</td>
                <td className="px-5 py-3.5 text-right tabular-nums">{e.chain.member_count}</td>
                <td className="px-5 py-3.5 text-right tabular-nums">{e.chain.ballot_count}</td>
                <td className="px-5 py-3.5">
                  {completed ? (
                    <span className="tabular-nums text-ink-2">
                      {e.chain.member_count ? Math.round((e.chain.ballot_count / e.chain.member_count) * 100) : 0}%
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {e.status === "published" && <PhaseBadge phase={e.phase} />}
                      <Badge tone={a.tone}>{a.label}</Badge>
                    </div>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Link href={`/admin/elections/${e.id}`} className="inline-flex items-center gap-1 font-semibold text-brand" aria-label={`Open ${e.title}`}>
                    Open <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AdminConsole() {
  const { data: me } = useMe()
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-elections"],
    queryFn: () => get<{ items: Election[] }>("/admin/elections"),
    refetchInterval: 8_000,
  })
  const items = data?.items ?? []
  const current = items.filter((e) => !done(e))
  const completed = items.filter(done)
  const count = (f: (e: Election) => boolean) => items.filter(f).length

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Election office"
        title="Admin console"
        description="Create elections, approve voters and run each stage of the election."
        actions={
          me?.roles.includes("admin") ? (
            <ButtonLink href="/admin/elections/new" icon={Plus}>
              New election
            </ButtonLink>
          ) : undefined
        }
      />
      <AdminNav />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Drafts" value={count((e) => e.status === "draft" || e.status === "failed")} icon={FileText} tone="neutral" />
        <Stat label="Registration open" value={count((e) => e.phase === "registration")} icon={ListChecks} tone="accent" />
        <Stat label="Voting now" value={count((e) => e.phase === "voting")} icon={Vote} tone="ok" />
        <Stat label="Completed" value={completed.length} icon={CheckCircle2} />
      </div>

      {error && <Alert tone="bad">{error.message}</Alert>}
      <Card title="Current elections" icon={Layers} description="Drafts and elections that are still running" padded={false}>
        {isLoading ? (
          <div className="p-5">
            <Skeleton className="h-32" />
          </div>
        ) : current.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Layers}
              title="No elections in progress"
              action={me?.roles.includes("admin") ? <ButtonLink href="/admin/elections/new" icon={Plus}>Create an election</ButtonLink> : undefined}
            >
              Create an election to get started. It stays a draft until you publish it.
            </EmptyState>
          </div>
        ) : (
          <ElectionTable items={current} />
        )}
      </Card>

      {completed.length > 0 && (
        <Card title="Completed elections" icon={CheckCircle2} description="Results declared" padded={false}>
          <ElectionTable items={completed} completed />
        </Card>
      )}
    </div>
  )
}

export default function AdminPage() {
  return (
    <RequireAuth roles={["admin", "officer"]}>
      <AdminConsole />
    </RequireAuth>
  )
}
