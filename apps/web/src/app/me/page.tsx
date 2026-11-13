"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Inbox, KeyRound, Mail, ShieldCheck, Trash2, Vote } from "lucide-react"
import { get, post } from "@/lib/api"
import type { Registration, Role } from "@/lib/types"
import { RequireAuth, isStaff, useMe } from "@/components/providers"
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PhaseBadge,
  Skeleton,
  Stepper,
  type Tone,
} from "@/components/ui"

const STATUS: Record<Registration["status"], { label: string; tone: Tone; step: number }> = {
  pending_review: { label: "Under review", tone: "brand", step: 1 },
  approved: { label: "Create your identity", tone: "warn", step: 2 },
  rejected: { label: "Not approved", tone: "bad", step: 1 },
  commitment_submitted: { label: "Joining the roll", tone: "brand", step: 3 },
  enrolled: { label: "On the roll", tone: "ok", step: 4 },
}

const ROLE_LABEL: Record<Role, string> = { voter: "Voter", owner: "Super admin", admin: "Election admin", officer: "Election officer", trustee: "Trustee", observer: "Observer" }

function ChangePassword() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [next2, setNext2] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setMsg(null)
    if (next.length < 10) return setMsg({ tone: "bad", text: "Use at least 10 characters" })
    if (next !== next2) return setMsg({ tone: "bad", text: "The new passwords do not match" })
    setBusy(true)
    try {
      await post("/auth/password/change", { current_password: current, new_password: next })
      setCurrent("")
      setNext("")
      setNext2("")
      setOpen(false)
      setMsg({ tone: "ok", text: "Password changed. You've been signed out on your other devices." })
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not change your password" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Password" icon={KeyRound}>
      {open ? (
        <form onSubmit={submit} className="space-y-4">
          <Field id="pw-current" label="Current password">
            <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(x) => setCurrent(x.target.value)} />
          </Field>
          <Field id="pw-new" label="New password" hint="At least 10 characters">
            <Input id="pw-new" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(x) => setNext(x.target.value)} />
          </Field>
          <Field id="pw-new2" label="Repeat new password">
            <Input id="pw-new2" type="password" autoComplete="new-password" required value={next2} onChange={(x) => setNext2(x.target.value)} />
          </Field>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" busy={busy} icon={KeyRound}>
              Change password
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <p className="text-sm text-muted">Changing your password signs you out on every other device.</p>
          <Button variant="secondary" icon={KeyRound} className="w-full" onClick={() => setOpen(true)}>
            Change password
          </Button>
        </div>
      )}
    </Card>
  )
}

function Account() {
  const { data: me } = useMe()
  const staff = isStaff(me)
  const router = useRouter()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-registrations"],
    queryFn: () => get<{ items: Registration[] }>("/me/registrations"),
    enabled: !!me && !isStaff(me),
    refetchInterval: 8_000,
  })

  const [deleteError, setDeleteError] = useState<string | null>(null)
  async function deleteAccount() {
    if (!confirm("Delete your account and personal data? This cannot be undone.")) return
    setDeleteError(null)
    try {
      await post("/auth/me/delete")
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete your account")
      return
    }
    qc.setQueryData(["me"], null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" })
    router.push("/")
  }

  return (
    <div>
      <PageHeader
        eyebrow="Your account"
        title={staff ? "My account" : "Account & registrations"}
        description={staff ? "Your profile and your data." : "Your profile, every election you've applied for, and your data."}
        back={staff ? { href: "/admin", label: "Admin console" } : { href: "/dashboard", label: "Dashboard" }}
      />

      <div className={staff ? "grid max-w-xl gap-8" : "grid gap-8 lg:grid-cols-[1fr_2.2fr]"}>
        <aside className="space-y-5">
          {me && (
            <Card>
              <div className="flex items-center gap-4">
                <Avatar name={me.name} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{me.name}</p>
                  <p className="flex items-center gap-1.5 truncate text-sm text-muted">
                    <Mail className="size-3.5" aria-hidden /> {me.email}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {me.roles.map((r) => (
                  <Badge key={r} tone={r === "voter" ? "neutral" : "brand"}>
                    {ROLE_LABEL[r]}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
          <ChangePassword />
          <Card title="Your data" icon={ShieldCheck}>
            <p className="text-sm text-muted">
              We keep your name and email only to run elections, and ID proofs are deleted after the results. Deleting your account erases your
              personal data; the public roll keeps only your anonymous fingerprint. Grievances go to your election office.
            </p>
            {deleteError && (
              <div className="mt-4">
                <Alert tone="bad">{deleteError}</Alert>
              </div>
            )}
            <Button variant="danger" icon={Trash2} className="mt-5 w-full" onClick={deleteAccount}>
              Delete my account
            </Button>
          </Card>
        </aside>

        {!staff && (
        <section className="space-y-4">
          {isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-40" />)}
          {error && <Alert tone="bad">{error.message}</Alert>}
          {data?.items.length === 0 && (
            <EmptyState icon={Inbox} title="No registrations yet" action={<ButtonLink href="/elections" icon={Vote}>Browse elections</ButtonLink>}>
              Find an election that&apos;s open for registration and apply to vote.
            </EmptyState>
          )}
          {data?.items.map((r) => {
            const st = STATUS[r.status]
            const regOpen = r.phase === "pending" || r.phase === "registration"
            const canReapply = r.status === "rejected" && r.can_reapply && regOpen
            const cta =
              r.phase === "voting" && r.status === "enrolled"
                ? { href: `/elections/${r.election_slug}/vote`, label: "Vote now" }
                : {
                    href: `/elections/${r.election_slug}/register`,
                    label: r.status === "approved" ? "Create identity" : canReapply ? "Apply again" : "View details",
                  }
            return (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold tracking-tight">{r.election_title}</p>
                    <p className="text-sm text-muted">Registration no. {r.reg_no}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <PhaseBadge phase={r.phase ?? null} />
                    <Badge tone={st.tone} dot>
                      {st.label}
                    </Badge>
                  </div>
                </div>
                <div className="mt-5">
                  <Stepper steps={["Apply", "Review", "Identity", "On the roll"]} current={st.step} />
                </div>
                {r.status === "rejected" && (
                  <div className="mt-4">
                    <Alert tone="bad" title={r.reject_reason ? `Reason: ${r.reject_reason}` : undefined}>
                      {canReapply
                        ? "You can fix this and apply once more."
                        : r.can_reapply
                          ? "Registration is closed, so you can't apply again."
                          : "This was your last attempt, so you can't vote in this election."}
                    </Alert>
                  </div>
                )}
                <div className="mt-5 flex justify-end">
                  <ButtonLink href={cta.href} variant={cta.label === "View details" ? "secondary" : "primary"} iconRight={ArrowRight}>
                    {cta.label}
                  </ButtonLink>
                </div>
              </Card>
            )
          })}
        </section>
        )}
      </div>
    </div>
  )
}

export default function MePage() {
  return (
    <RequireAuth>
      <Account />
    </RequireAuth>
  )
}
