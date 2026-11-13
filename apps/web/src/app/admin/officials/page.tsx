"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Search, ShieldCheck, UsersRound, X } from "lucide-react"
import { api, post } from "@/lib/api"
import type { Role, User } from "@/lib/types"
import { RequireAuth, useMe } from "@/components/providers"
import { AdminNav } from "@/components/admin-nav"
import { Alert, Avatar, Card, EmptyState, Input, PageHeader, Skeleton, cx, fmtDate } from "@/components/ui"

type Row = User & { created_at: string }

const ROLES: { role: Role; label: string; d: string }[] = [
  { role: "admin", label: "Admin", d: "Creates elections, approves voters, manages officials" },
  { role: "officer", label: "Election officer", d: "Pauses, opens and closes voting, declares results" },
  { role: "trustee", label: "Trustee", d: "Holds a share of a sealed election's key" },
  { role: "observer", label: "Observer", d: "Can read the audit log" },
]

function Officials() {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const [q, setQ] = useState("")
  const [error, setError] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => api<{ items: Row[] }>(`/admin/users?q=${encodeURIComponent(q)}`),
  })

  async function toggle(u: Row, role: Role) {
    setError(null)
    try {
      if (u.roles.includes(role)) await api(`/admin/users/${u.id}/roles/${role}`, { method: "DELETE" })
      else await post(`/admin/users/${u.id}/roles`, { role })
      await qc.invalidateQueries({ queryKey: ["admin-users"] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change role")
    }
  }

  const officials = (data?.items ?? []).filter((u) => u.roles.some((r) => r !== "voter")).length

  return (
    <div>
      <PageHeader
        eyebrow="Election office"
        title="Officials and roles"
        description="Give people the roles they need to run elections. Every change is recorded in the audit log."
      />
      <AdminNav />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r.role} className="rounded-xl border border-line bg-surface p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <ShieldCheck className="size-4 text-accent" aria-hidden /> {r.label}
            </p>
            <p className="mt-1 text-xs text-muted">{r.d}</p>
          </div>
        ))}
      </div>

      <Card
        title="People"
        icon={UsersRound}
        description={`${data?.items.length ?? 0} shown · ${officials} with an official role`}
        padded={false}
        action={
          <label className="relative block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <span className="sr-only">Search people</span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" />
          </label>
        }
      >
        {error && (
          <div className="px-5 pt-4">
            <Alert tone="bad">{error}</Alert>
          </div>
        )}
        {isLoading ? (
          <div className="p-5">
            <Skeleton className="h-40" />
          </div>
        ) : !data?.items.length ? (
          <div className="p-5">
            <EmptyState icon={UsersRound} title="Nobody found">
              People appear here after they create a SecVote account.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-xs font-medium text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {u.email} · joined {fmtDate(u.created_at)}
                    {!u.email_verified && " · email not verified"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Roles for ${u.name}`}>
                  {ROLES.map(({ role, label }) => {
                    const on = u.roles.includes(role)
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(u, role)}
                        className={cx(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset transition",
                          on ? "bg-brand text-brand-ink ring-brand" : "bg-surface text-ink-2 ring-line-strong hover:ring-brand",
                        )}
                      >
                        {on && <X className="size-3" aria-hidden />}
                        {label}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export default function OfficialsPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <Officials />
    </RequireAuth>
  )
}
