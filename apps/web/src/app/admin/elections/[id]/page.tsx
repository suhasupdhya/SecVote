"use client"

import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  Blocks,
  Check,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Gavel,
  Inbox,
  ListChecks,
  Loader2,
  Lock,
  BarChart3,
  FastForward,
  Square,
  Trophy,
  Pause,
  Pencil,
  Play,
  TimerOff,
  Rocket,
  UserCheck,
  Users,
  Vote,
  Trash2,
  X,
  XCircle,
} from "lucide-react"
import { api, get, post } from "@/lib/api"
import { useElection } from "@/lib/hooks"
import type { Election, RegistrationStatus, ReviewItem } from "@/lib/types"
import { RequireAuth, useMe } from "@/components/providers"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { AdminNav } from "@/components/admin-nav"
import { TrusteesCard } from "@/components/trustees-card"
import { EligibilityCard } from "@/components/eligibility-card"
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  HashChip,
  PageHeader,
  PageLoader,
  PhaseBadge,
  Skeleton,
  Stat,
  cx,
  fmtDate,
  type Tone,
} from "@/components/ui"

const FILTERS: { key: RegistrationStatus | ""; label: string }[] = [
  { key: "pending_review", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "commitment_submitted", label: "Joining roll" },
  { key: "enrolled", label: "Enrolled" },
  { key: "rejected", label: "Rejected" },
  { key: "", label: "All" },
]
const REG_TONE: Record<RegistrationStatus, Tone> = {
  pending_review: "brand",
  approved: "warn",
  commitment_submitted: "accent",
  enrolled: "ok",
  rejected: "bad",
}

const STATUS_LABEL: Record<Election["status"], string> = { draft: "Draft", deploying: "Deploying", published: "Published", failed: "Deployment failed" }
const REG_LABEL: Record<RegistrationStatus, string> = {
  pending_review: "Pending",
  approved: "Approved",
  commitment_submitted: "Joining roll",
  enrolled: "Enrolled",
  rejected: "Rejected",
}

/** What will be deployed: shown before publishing so the admin can check it (the config is locked once on chain). */
function SetupSummary({ e }: { e: Election }) {
  const facts = [
    ["Ballot", e.mode === "sealed" ? "Sealed (counted after voting closes)" : "Open count"],
    ["NOTA", e.allow_nota ? "Allowed" : "Not offered"],
    ["Voter approval", e.high_stakes ? "Two officials" : "One official"],
  ]
  return (
    <Card title="What you're publishing" icon={ListChecks} description="Check the details. Nothing can be changed once the election is on chain.">
      <div className="space-y-6">
        <dl className="grid gap-3 sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-subtle px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</dt>
              <dd className="mt-1 text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {e.races.map((r) => (
          <div key={r.id}>
            <p className="flex flex-wrap items-baseline gap-2 font-semibold">
              {r.title}
              <span className="text-xs font-normal text-muted">
                {r.candidates.length} candidate{r.candidates.length === 1 ? "" : "s"} · {r.method === "irv" ? "ranked choice" : "pick one"}
              </span>
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {r.candidates.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-xl border border-line py-1.5 pl-1.5 pr-3 text-sm">
                  <Avatar name={c.name} size="sm" />
                  {c.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ReviewQueue({ electionId, regOpen }: { electionId: string; regOpen: boolean }) {
  // Once registration closes there is nothing left to review: show everyone instead.
  const [status, setStatus] = useState<RegistrationStatus | "">(regOpen ? "pending_review" : "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ["review", electionId, status],
    queryFn: () => get<{ items: ReviewItem[] }>(`/admin/elections/${electionId}/registrations${status ? `?status=${status}` : ""}`),
    refetchInterval: 4_000,
  })

  async function act(r: ReviewItem, action: "approve" | "reject") {
    const id = r.id
    setError(null)
    try {
      if (action === "reject") {
        const last = r.attempts >= r.max_attempts
        const reason = prompt(
          last
            ? `Reason for rejection (shown to the applicant).\n\nThis is ${r.name}'s last attempt: once rejected, they can't apply again or vote in this election.`
            : `Reason for rejection (shown to the applicant).\n\n${r.name} will be able to correct this and apply once more.`,
        )
        if (!reason) return
        setBusy(id)
        await post(`/admin/registrations/${id}/reject`, { reason })
      } else {
        setBusy(id)
        await post(`/admin/registrations/${id}/approve`)
      }
      await qc.invalidateQueries({ queryKey: ["review", electionId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title={regOpen ? "Voter review queue" : "Voter applications"}
      icon={UserCheck}
      description={regOpen ? "Check each ID card before approving. Approvals are logged in the audit trail." : "Registration has closed, so applications can no longer be reviewed."}
      padded={false}
    >
      <div className="flex flex-wrap gap-1 border-y border-line bg-subtle/50 px-5 py-2.5" role="tablist" aria-label="Filter registrations">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            role="tab"
            aria-selected={status === f.key}
            onClick={() => setStatus(f.key)}
            className={cx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              status === f.key ? "bg-surface text-brand shadow-sm ring-1 ring-line" : "text-ink-2 hover:text-ink",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="bad">{error}</Alert>
        </div>
      )}
      {q.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-24" />
        </div>
      ) : q.data?.items.length ? (
        <ul className="divide-y divide-line">
          {q.data.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <Avatar name={r.name} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {r.name}
                  {r.attempts > 1 && (
                    <Badge tone="warn">
                      Re-applied · last attempt
                    </Badge>
                  )}
                  {r.auto_approved ? (
                    <Badge tone="ok">Approved from voter list</Badge>
                  ) : (
                    r.on_list && <Badge tone="brand">On voter list</Badge>
                  )}
                </p>
                <p className="truncate text-sm text-muted">
                  {r.email} · <span className="font-medium text-ink-2">{r.reg_no}</span> · {r.department}, year {r.year}
                </p>
                {r.status === "pending_review" && r.previous_reject_reason && (
                  <p className="mt-1 text-xs text-muted">
                    Rejected before: <span className="text-ink-2">{r.previous_reject_reason}</span>
                  </p>
                )}
                {r.status === "rejected" && (
                  <p className="mt-1 text-xs text-muted">
                    {r.reject_reason && (
                      <>
                        Reason: <span className="text-ink-2">{r.reject_reason}</span> ·{" "}
                      </>
                    )}
                    {r.attempts >= r.max_attempts ? "Final, can't apply again" : "Can apply once more"}
                  </p>
                )}
                {r.approvals_needed > 1 && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                    {Array.from({ length: r.approvals_needed }).map((_, i) => (
                      <span
                        key={i}
                        className={cx("grid size-5 place-items-center rounded-full", i < r.approvals ? "bg-ok text-white" : "bg-subtle ring-1 ring-line-strong")}
                      >
                        {i < r.approvals && <Check className="size-3" />}
                      </span>
                    ))}
                    <span>
                      {r.approvals}/{r.approvals_needed} approvals{r.approved_by_me ? ", a second official must approve" : ""}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {r.has_document && (
                  <a
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm font-semibold transition hover:border-brand hover:text-brand"
                    href={`/api/v1/admin/registrations/${r.id}/document`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileSearch className="size-4" aria-hidden /> View ID
                  </a>
                )}
                {r.status === "pending_review" && regOpen ? (
                  <>
                    <Button size="sm" icon={Check} busy={busy === r.id} onClick={() => act(r, "approve")} disabled={r.approved_by_me} aria-label={`Approve ${r.name}`}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" icon={X} onClick={() => act(r, "reject")}>
                      Reject
                    </Button>
                  </>
                ) : (
                  <Badge tone={REG_TONE[r.status]} dot>
                    {REG_LABEL[r.status]}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-5">
          <EmptyState icon={Inbox} title="Nothing here">
            {status === "pending_review" ? "No applications are waiting for review." : "No registrations in this view."}
          </EmptyState>
        </div>
      )}
    </Card>
  )
}

type Early = "end-registration" | "start-voting" | "end-voting"

function NextStep({
  e,
  isOfficer,
  isAdmin,
  busy,
  action,
  onEarly,
}: {
  e: Election
  isOfficer: boolean
  isAdmin: boolean
  busy: string | null
  action: (p: string, l: string) => void
  onEarly: (k: Early) => void
}) {
  let title = ""
  let body = ""
  let button: React.ReactNode = null
  const closing = e.transactions?.find(
    (t) =>
      (t.kind === "end_registration" || t.kind === "start_voting" || t.kind === "end_voting") &&
      (t.status === "pending" || t.status === "sent"),
  )
  const earlyButtons = (withEnd: boolean) =>
    isOfficer && !e.chain.paused ? (
      <div className="flex flex-wrap gap-2">
        {withEnd && (
          <Button variant="secondary" onClick={() => onEarly("end-registration")} icon={TimerOff}>
            End registration now
          </Button>
        )}
        <Button onClick={() => onEarly("start-voting")} icon={FastForward}>
          Start voting now
        </Button>
      </div>
    ) : null
  const sealed = e.mode === "sealed"
  if ((e.status === "draft" || e.status === "failed") && sealed && !e.chain.public_key) {
    title = "Set up the trustees and key ceremony"
    body = "Sealed ballots are encrypted to a key held by three trustees. Add them below, then run the key ceremony. You can publish after that."
  } else if (e.status === "draft" || e.status === "failed") {
    title = e.status === "failed" ? "Needs publishing again" : "Ready to publish"
    body =
      e.status === "failed"
        ? (e.chain.error ?? "The last deployment failed. Publish again to retry.")
        : "Publishing deploys this election's contract. The configuration is locked once it's on chain."
    button = isAdmin ? (
      <Button onClick={() => action("publish", "Deployment")} busy={busy === "publish"} size="lg" icon={Rocket}>
        Publish on chain
      </Button>
    ) : null
  } else if (e.status === "deploying") {
    title = "Deploying contract…"
    body = "The worker is sending the deployment transaction. This page updates automatically."
  } else if (closing) {
    title =
      closing.kind === "start_voting" ? "Opening voting now…" : closing.kind === "end_voting" ? "Closing voting now…" : "Closing registration now…"
    body = "The transaction is on its way to the chain. This page updates as soon as it confirms."
  } else if (e.phase === "pending") {
    title = "Waiting for registration to open"
    body = `Registration opens ${fmtDate(e.reg_start)}.`
  } else if (e.phase === "registration") {
    title = "Registration is open"
    body = `Closes ${fmtDate(e.reg_end)}. Review applications below, or close registration early once everyone is on the roll.`
    button = earlyButtons(true)
  } else if (!e.chain.frozen) {
    title = "Freeze the voter roll"
    body = "Registration has closed. The worker freezes the roll automatically, or you can freeze it now."
    button = (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => action("freeze", "Freeze")} busy={busy === "freeze"} icon={Lock}>
          Freeze roll
        </Button>
        {earlyButtons(false)}
      </div>
    )
  } else if (e.phase === "awaiting_vote") {
    title = "Roll frozen: voting opens soon"
    body = `${e.chain.member_count} voter${e.chain.member_count === 1 ? " is" : "s are"} locked into the roll. Voting opens ${fmtDate(e.vote_start)}, or open it now.`
    button = earlyButtons(false)
  } else if (e.phase === "voting") {
    title = "Voting is open"
    body = `${e.chain.ballot_count} ballot${e.chain.ballot_count === 1 ? "" : "s"} so far. Closes ${fmtDate(e.vote_end)}, or end voting now to see the final result.`
    button =
      isOfficer && !e.chain.paused ? (
        <Button variant="danger" onClick={() => onEarly("end-voting")} icon={Square}>
          End voting now
        </Button>
      ) : null
  } else if (e.phase === "closed" && sealed && !e.chain.revealed_key) {
    const released = (e.trustees ?? []).filter((t) => t.share_uploaded).length
    title = "Waiting for the trustees to unlock the count"
    body = `${released} of 2 trustee shares released. Ask your trustees to open their Trustee page and release their share. Votes are counted automatically once the key is revealed on chain.`
  } else if (e.phase === "closed" && !e.chain.result_hash) {
    title = "Declare the result"
    body = "Voting has closed. Declaring posts the result hash on chain so anyone can verify the count."
    button = (
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/elections/${e.slug}/bulletin`} variant="secondary" icon={BarChart3}>
          Preview results
        </ButtonLink>
        {isOfficer && (
          <Button onClick={() => action("declare", "Result declaration")} busy={busy === "declare"} icon={Gavel}>
            Declare result
          </Button>
        )}
      </div>
    )
  } else {
    title = "Result declared"
    body = "The election is complete. The result hash is on chain and anyone can recount it."
    button = (
      <ButtonLink href={`/elections/${e.slug}/bulletin`} icon={Trophy}>
        View results
      </ButtonLink>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-brand-panel p-6 text-white shadow-[var(--shadow-lift)] sm:p-7">
      <span className="grid size-12 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
        {e.status === "deploying" || closing ? <Loader2 className="size-6 animate-spin" /> : <Activity className="size-6" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Next step</p>
        <p className="mt-0.5 text-xl font-bold">{title}</p>
        <p className="mt-1 text-sm text-white/80">{body}</p>
      </div>
      {button && <div className="rounded-xl bg-white/10 p-1">{button}</div>}
    </div>
  )
}

function AdminElection() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: me } = useMe()
  const { data: e, isLoading, error, refetch } = useElection(id, { admin: true, poll: 3_000 })
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [early, setEarly] = useState<Early | null>(null)

  if (isLoading) return <PageLoader />
  if (error || !e) return <Alert tone="bad" title="Not found">{error?.message}</Alert>
  const isOfficer = !!me?.roles.includes("officer")
  const isAdmin = !!me?.roles.includes("admin")
  // Drafts have no contract, roll or transactions yet: don't show empty panels for them.
  const onChain = !!e.chain.address || !!e.transactions?.length
  const rollEmpty = e.chain.member_count === 0

  async function action(path: string, label: string) {
    setBusy(path)
    setMsg(null)
    try {
      await post(`/admin/elections/${id}/${path}`)
      setMsg({ tone: "ok", text: `${label} queued. It's final once the transaction confirms.` })
      await refetch()
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Failed" })
    } finally {
      setBusy(null)
    }
  }

  async function deleteDraft() {
    if (!e || !confirm(`Delete the draft "${e.title}"? This cannot be undone.`)) return
    setBusy("delete")
    try {
      await api(`/admin/elections/${id}`, { method: "DELETE" })
      router.push("/admin")
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not delete" })
      setBusy(null)
    }
  }

  const txTone: Record<string, Tone> = { confirmed: "ok", failed: "bad", pending: "warn", sent: "brand" }

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/admin", label: "All elections" }}
        eyebrow={e.org}
        title={e.title}
        badges={
          <>
            {e.status === "published" ? (
              <PhaseBadge phase={e.phase} />
            ) : (
              <Badge tone={e.status === "failed" ? "bad" : e.status === "deploying" ? "warn" : "neutral"}>{STATUS_LABEL[e.status]}</Badge>
            )}
            {e.chain.paused && (
              <Badge tone="bad" dot>
                Paused
              </Badge>
            )}
          </>
        }
        description={
          <span className="flex flex-col gap-1 text-sm sm:text-base">
            <span>
              <span className="font-semibold text-ink-2">Registration</span> {fmtDate(e.reg_start)} – {fmtDate(e.reg_end)}
            </span>
            <span>
              <span className="font-semibold text-ink-2">Voting</span> {fmtDate(e.vote_start)} – {fmtDate(e.vote_end)}
            </span>
          </span>
        }
        actions={
          e.status === "published" ? (
            <>
              <ButtonLink href={`/elections/${e.slug}`} variant="secondary" icon={ExternalLink}>
                Public page
              </ButtonLink>
              {isOfficer &&
                !e.chain.result_hash &&
                (e.chain.paused ? (
                  <Button variant="secondary" onClick={() => action("unpause", "Unpause")} busy={busy === "unpause"} icon={Play}>
                    Unpause
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => action("pause", "Pause")} busy={busy === "pause"} icon={Pause}>
                    Pause
                  </Button>
                ))}
            </>
          ) : (e.status === "draft" || e.status === "failed") && isAdmin ? (
            <>
              <ButtonLink href={`/admin/elections/${e.id}/edit`} variant="secondary" icon={Pencil}>
                Edit draft
              </ButtonLink>
              {e.status === "draft" && !e.chain.address && (
                <Button variant="ghost" icon={Trash2} busy={busy === "delete"} onClick={deleteDraft}>
                  Delete
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <AdminNav />

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <NextStep e={e} isOfficer={isOfficer} isAdmin={isAdmin} busy={busy} action={action} onEarly={setEarly} />
      <ConfirmDialog
        open={early === "end-voting"}
        onClose={() => setEarly(null)}
        busy={busy === "end-voting"}
        icon={Square}
        confirmVariant="danger"
        title="End voting now?"
        confirmLabel="End voting now"
        onConfirm={async () => {
          await action("end-voting", "Closing voting")
          setEarly(null)
        }}
      >
        <ul className="space-y-1.5 rounded-xl bg-subtle p-3.5">
          <li>
            Voting closes <strong>now</strong> instead of {fmtDate(e.vote_end)}.
          </li>
          <li>
            <strong>{e.chain.ballot_count}</strong> ballot{e.chain.ballot_count === 1 ? "" : "s"} from {e.chain.member_count} registered voter
            {e.chain.member_count === 1 ? "" : "s"} will be counted.
          </li>
          <li>You can then declare the result, and voters see the final, verifiable count.</li>
        </ul>
        {e.chain.member_count > e.chain.ballot_count && (
          <Alert tone="warn">
            {e.chain.member_count - e.chain.ballot_count} registered voter{e.chain.member_count - e.chain.ballot_count === 1 ? " hasn't" : "s haven't"}{" "}
            voted yet and won&apos;t be able to after this.
          </Alert>
        )}
        <p className="text-xs text-muted">This is recorded on chain and in the audit log. Voting can never be reopened.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={early === "end-registration" || early === "start-voting"}
        onClose={() => setEarly(null)}
        busy={busy === early}
        icon={early === "start-voting" ? FastForward : TimerOff}
        title={early === "start-voting" ? "Start voting now?" : "End registration now?"}
        confirmLabel={early === "start-voting" ? "Start voting now" : "End registration now"}
        disabled={rollEmpty}
        onConfirm={async () => {
          const k = early
          if (!k) return
          await action(k, k === "start-voting" ? "Opening voting" : "Closing registration")
          setEarly(null)
        }}
      >
        <ul className="space-y-1.5 rounded-xl bg-subtle p-3.5">
          {e.phase === "registration" && (
            <li>
              Registration closes <strong>now</strong> instead of {fmtDate(e.reg_end)}.
            </li>
          )}
          {!e.chain.frozen && (
            <li>
              The voter roll is <strong>frozen</strong> with {e.roll_status?.enrolled ?? e.chain.member_count} voter
              {(e.roll_status?.enrolled ?? e.chain.member_count) === 1 ? "" : "s"}.
            </li>
          )}
          {early === "start-voting" ? (
            <li>
              Voting opens <strong>now</strong> instead of {fmtDate(e.vote_start)} and still closes {fmtDate(e.vote_end)}.
            </li>
          ) : (
            <li>Voting still opens {fmtDate(e.vote_start)}; you can open it early afterwards.</li>
          )}
        </ul>
        {rollEmpty && (
          <Alert tone="bad" title="Nobody is on the voter roll yet">
            Closing registration now would freeze an empty roll, and nobody could vote. Wait until approved voters have created their
            voting identity.
          </Alert>
        )}
        {e.phase === "registration" && (e.roll_status?.pending_review ?? 0) > 0 && (
          <Alert tone="warn">
            {e.roll_status!.pending_review} application{e.roll_status!.pending_review === 1 ? " is" : "s are"} still waiting for review and
            won&apos;t be able to vote.
          </Alert>
        )}
        {e.phase === "registration" && (e.roll_status?.approved_no_identity ?? 0) > 0 && (
          <Alert tone="warn">
            {e.roll_status!.approved_no_identity} approved voter{e.roll_status!.approved_no_identity === 1 ? " hasn't" : "s haven't"} created
            their voting identity yet and will be left out.
          </Alert>
        )}
        {e.phase === "registration" && (e.roll_status?.joining_roll ?? 0) > 0 && (
          <Alert tone="bad">
            {e.roll_status!.joining_roll} voter{e.roll_status!.joining_roll === 1 ? " is" : "s are"} still being added to the roll. Wait a few
            seconds before closing.
          </Alert>
        )}
        <p className="text-xs text-muted">
          This is recorded on chain and in the audit log, and can&apos;t be undone: registration can never be reopened.
        </p>
      </ConfirmDialog>

      {onChain && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Voters on roll"
          value={e.chain.member_count}
          icon={Users}
          sub={e.status !== "published" ? "Not published yet" : e.chain.frozen ? "Roll frozen" : "Roll still open"}
        />
        <Stat label="Ballots" value={e.chain.ballot_count} icon={Vote} tone="ok" />
        <Stat
          label="Turnout"
          value={`${e.chain.member_count ? Math.round((e.chain.ballot_count / e.chain.member_count) * 100) : 0}%`}
          icon={Activity}
          tone="accent"
        />
        <Stat label="Posts" value={e.races.length} icon={CheckCircle2} tone="neutral" sub={e.races.map((r) => r.title).join(", ")} />
      </div>
      )}

      <div className={cx("grid gap-8", onChain && "xl:grid-cols-[1.7fr_1fr]")}>
        <div className="space-y-8">
          {e.mode === "sealed" && <TrusteesCard e={e} />}
          {e.status === "published" ? <ReviewQueue electionId={e.id} regOpen={e.phase === "pending" || e.phase === "registration"} /> : <SetupSummary e={e} />}
          {isAdmin && <EligibilityCard e={e} />}
        </div>
        {onChain && (
        <aside className="space-y-6">
          <Card title="Contract" icon={Blocks}>
            <dl className="space-y-4 text-sm">
              {[
                ["Address", e.chain.address],
                ["Frozen root", e.chain.frozen ? e.chain.frozen_root : null],
                ["Result hash", e.chain.result_hash],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</dt>
                  <dd className="mt-1">
                    <HashChip value={v} n={10} />
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Transactions" icon={Activity} padded={false}>
            {e.transactions?.length ? (
              <ul className="divide-y divide-line border-t border-line">
                {e.transactions.map((t) => (
                  <li key={t.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium capitalize">
                        {t.status === "confirmed" ? (
                          <CheckCircle2 className="size-4 text-ok" aria-hidden />
                        ) : t.status === "failed" ? (
                          <XCircle className="size-4 text-bad" aria-hidden />
                        ) : (
                          <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
                        )}
                        {t.kind.replaceAll("_", " ")}
                      </span>
                      <Badge tone={txTone[t.status] ?? "neutral"}>{t.status.charAt(0).toUpperCase() + t.status.slice(1)}</Badge>
                    </div>
                    {t.tx_hash && (
                      <div className="mt-1.5 pl-6">
                        <HashChip value={t.tx_hash} n={8} />
                      </div>
                    )}
                    {t.error && <p className="mt-1 pl-6 text-xs text-bad">{t.error}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-line px-5 py-4 text-sm text-muted">No transactions yet.</p>
            )}
          </Card>
        </aside>
        )}
      </div>
    </div>
  )
}

export default function AdminElectionPage() {
  return (
    <RequireAuth roles={["admin", "officer"]}>
      <AdminElection />
    </RequireAuth>
  )
}
