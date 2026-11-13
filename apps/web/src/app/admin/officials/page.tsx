"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Clock, Crown, Search, ShieldCheck, UserCheck, UsersRound, X } from "lucide-react"
import { api, post } from "@/lib/api"
import type { Role, User } from "@/lib/types"
import { RequireAuth, useMe } from "@/components/providers"
import { AdminNav } from "@/components/admin-nav"
import { Alert, Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Skeleton, cx, fmtDate } from "@/components/ui"

type Row = User & { created_at: string }
type RoleRequest = {
  id: string
  role: Role
  user: { id: string; name: string; email: string }
  requested_by: { id: string; name: string }
  created_at: string
  can_approve: boolean
}

const ROLES: { role: Role; label: string; d: string; guarded?: boolean }[] = [
  { role: "owner", label: "Super admin", d: "Highest authority. The only role that can create, approve or remove admins. One to three people.", guarded: true },
  { role: "admin", label: "Election admin", d: "Creates and runs elections, approves voters, sees statistics. Cannot create admins.", guarded: true },
  { role: "officer", label: "Election officer", d: "Pauses, opens and closes voting, declares results" },
  { role: "trustee", label: "Trustee", d: "Holds a share of a sealed election's key" },
  { role: "observer", label: "Observer", d: "Can read the audit log" },
]
const LABEL = Object.fromEntries(ROLES.map((r) => [r.role, r.label])) as Record<Role, string>

function PendingRequests({ items, meId, onDone }: { items: RoleRequest[]; meId?: string; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function act(r: RoleRequest, approve: boolean) {
    setBusy(r.id)
    setError(null)
    try {
      if (approve) await post(`/admin/role-requests/${r.id}/approve`)
      else await api(`/admin/role-requests/${r.id}`, { method: "DELETE" })
      onDone(approve ? `${r.user.name} is now ${LABEL[r.role]}.` : `The request for ${r.user.name} was declined.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the request")
    } finally {
      setBusy(null)
    }
  }
  if (!items.length) return null
  return (
    <Card title="Waiting for approval" icon={Clock} description="A new admin or super admin takes effect only when a different super admin approves it." padded={false}>
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="bad">{error}</Alert>
        </div>
      )}
      <ul className="divide-y divide-line border-t border-line">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <Avatar name={r.user.name} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {r.user.name} <span className="font-normal text-muted">→</span> {LABEL[r.role]}
              </p>
              <p className="truncate text-sm text-muted">
                {r.user.email} · asked by {r.requested_by.name} · {fmtDate(r.created_at)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.can_approve ? (
                <Button size="sm" icon={Check} busy={busy === r.id} onClick={() => act(r, true)} aria-label={`Approve ${r.user.name} as ${LABEL[r.role]}`}>
                  Approve
                </Button>
              ) : (
                <Badge tone="warn">Needs a different super admin</Badge>
              )}
              <Button size="sm" variant="secondary" icon={X} onClick={() => act(r, false)}>
                {r.requested_by.id === meId ? "Withdraw" : "Decline"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Officials() {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const isOwner = !!me?.roles.includes("owner")
  const [q, setQ] = useState("")
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "brand"; text: string } | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => api<{ items: Row[] }>(`/admin/users?q=${encodeURIComponent(q)}`),
  })
  const requests = useQuery({
    queryKey: ["role-requests"],
    queryFn: () => api<{ items: RoleRequest[] }>("/admin/role-requests"),
    refetchInterval: 10_000,
  })
  const pendingFor = (userId: string, role: Role) => requests.data?.items.some((r) => r.user.id === userId && r.role === role)

  async function refresh() {
    await Promise.all([qc.invalidateQueries({ queryKey: ["admin-users"] }), qc.invalidateQueries({ queryKey: ["role-requests"] })])
  }

  async function toggle(u: Row, role: Role) {
    setMsg(null)
    const on = u.roles.includes(role)
    if (!on && (role === "admin" || role === "owner")) {
      const ok = confirm(
        `Make ${u.name} ${LABEL[role]}?\n\nIf there is another super admin, they must approve this before it takes effect. Every admin is emailed about it.`,
      )
      if (!ok) return
    }
    try {
      if (on) {
        await api(`/admin/users/${u.id}/roles/${role}`, { method: "DELETE" })
        setMsg({ tone: "ok", text: `${LABEL[role]} role removed from ${u.name}.` })
      } else {
        const res = await post<Row & { pending: boolean }>(`/admin/users/${u.id}/roles`, { role })
        setMsg(
          res.pending
            ? { tone: "brand", text: `Request sent. ${u.name} becomes ${LABEL[role]} once another admin approves it.` }
            : { tone: "ok", text: `${u.name} is now ${LABEL[role]}.` },
        )
      }
      await refresh()
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not change role" })
    }
  }

  const officials = (data?.items ?? []).filter((u) => u.roles.some((r) => r !== "voter")).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Election office"
        title="Officials and roles"
        description="Give people the roles they need to run elections. Every change is recorded in the audit log and emailed to all admins."
      />
      <AdminNav />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ROLES.map((r) => (
          <div key={r.role} className="rounded-xl border border-line bg-surface p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              {r.role === "owner" ? <Crown className="size-4 text-accent" aria-hidden /> : <ShieldCheck className="size-4 text-accent" aria-hidden />}
              {r.label}
            </p>
            <p className="mt-1 text-xs text-muted">{r.d}</p>
          </div>
        ))}
      </div>

      {!isOwner && (
        <Alert tone="brand" title="Only super admins can make or remove admins">
          You can give out the election officer, trustee and observer roles. Ask a super admin if someone needs to be an admin.
        </Alert>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <PendingRequests
        items={requests.data?.items ?? []}
        meId={me?.id}
        onDone={async (text) => {
          setMsg({ tone: "ok", text })
          await refresh()
        }}
      />

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
          <ul className="divide-y divide-line border-t border-line">
            {data.items.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {u.name}
                    {u.id === me?.id && <span className="text-xs font-medium text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-muted">
                    {u.email} · joined {fmtDate(u.created_at)}
                    {!u.email_verified && " · email not verified"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Roles for ${u.name}`}>
                  {ROLES.map(({ role, label, guarded }) => {
                    const on = u.roles.includes(role)
                    const pending = !on && pendingFor(u.id, role)
                    const locked = !!guarded && !isOwner
                    if (pending)
                      return (
                        <span key={role} className="inline-flex items-center gap-1 rounded-md bg-warn-50 px-2.5 py-1.5 text-xs font-semibold text-warn ring-1 ring-inset ring-warn/25">
                          <UserCheck className="size-3" aria-hidden /> {label}: awaiting approval
                        </span>
                      )
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={on}
                        disabled={locked}
                        title={locked ? "Only super admins can change this" : undefined}
                        onClick={() => toggle(u, role)}
                        className={cx(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-50",
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
