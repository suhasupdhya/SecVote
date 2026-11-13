"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Vote } from "lucide-react"
import { get } from "@/lib/api"
import type { Election } from "@/lib/types"
import { ElectionCard } from "@/components/election-card"
import { Alert, Button, EmptyState, Input, PageHeader, Skeleton, cx } from "@/components/ui"

const TABS = [
  { key: "open", label: "Open now", test: (e: Election) => e.phase === "voting" || e.phase === "registration" },
  { key: "upcoming", label: "Upcoming", test: (e: Election) => e.phase === "pending" || e.phase === "awaiting_vote" },
  { key: "results", label: "Results", test: (e: Election) => e.phase === "closed" },
  { key: "all", label: "All", test: () => true },
] as const
type Tab = (typeof TABS)[number]["key"]

const ORDER: Record<string, number> = { voting: 0, registration: 1, awaiting_vote: 2, pending: 3, closed: 4 }

export default function ElectionsPage() {
  const [tab, setTab] = useState<Tab>("open")
  const [q, setQ] = useState("")
  const { data, isLoading, error } = useQuery({
    queryKey: ["elections"],
    queryFn: () => get<{ items: Election[] }>("/elections"),
    refetchInterval: 10_000,
  })
  const all = useMemo(() => [...(data?.items ?? [])].sort((a, b) => (ORDER[a.phase ?? "closed"] ?? 9) - (ORDER[b.phase ?? "closed"] ?? 9)), [data])
  const counts = Object.fromEntries(TABS.map((t) => [t.key, all.filter(t.test).length])) as Record<Tab, number>
  const needle = q.trim().toLowerCase()
  const items = all
    .filter(TABS.find((t) => t.key === tab)!.test)
    .filter((e) => !needle || `${e.title} ${e.org}`.toLowerCase().includes(needle))

  return (
    <div>
      <PageHeader
        eyebrow="Elections"
        title="All elections"
        description="Find your election to register, cast your vote, or see the declared results."
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1" role="tablist" aria-label="Election status">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                "inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-semibold transition",
                tab === t.key ? "bg-brand text-brand-ink" : "text-ink-2 hover:bg-subtle",
              )}
            >
              {t.label}
              <span className={cx("rounded px-1.5 text-xs tabular-nums", tab === t.key ? "bg-white/20" : "bg-subtle text-muted")}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <span className="sr-only">Search elections</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or institution" className="pl-9" />
        </label>
      </div>

      {error && <Alert tone="bad" title="Could not load elections">{error.message}</Alert>}
      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Vote}
          title={needle ? "No elections match your search" : tab === "open" ? "No elections are open right now" : "Nothing to show here"}
          action={
            !needle && tab !== "results" && counts.results > 0 ? (
              <Button variant="secondary" onClick={() => setTab("results")}>
                See past results ({counts.results})
              </Button>
            ) : undefined
          }
        >
          {needle
            ? "Check the spelling or try the institution name."
            : tab === "open"
              ? "When your election office opens registration or voting, the election appears here."
              : "Try another tab to see more elections."}
        </EmptyState>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((e) => (
            <li key={e.id} className="animate-fade-up">
              <ElectionCard e={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
