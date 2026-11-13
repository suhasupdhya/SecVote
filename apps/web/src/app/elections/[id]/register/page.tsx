"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  Clock,
  Download,
  EyeOff,
  FileUp,
  Hourglass,
  KeyRound,
  ListPlus,
  LogIn,
  MailCheck,
  RotateCw,
  ShieldCheck,
  Vote,
  XCircle,
} from "lucide-react"
import { get, post } from "@/lib/api"
import { useElection } from "@/lib/hooks"
import { isStaff, useMe } from "@/components/providers"
import type { Election, Registration } from "@/lib/types"
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CheckRow,
  EmptyState,
  Field,
  HashChip,
  Input,
  PageHeader,
  PageLoader,
  PhaseBadge,
  Spinner,
  Stepper,
} from "@/components/ui"
import { MIN_PASSPHRASE, createIdentity, downloadBackup, encryptIdentity, saveLocal, type EncryptedIdentity } from "@/lib/crypto/identity"

const STEPS = ["Apply", "Review", "Identity", "On the roll"]
function stepOf(reg?: Registration): number {
  if (!reg) return 0
  return { pending_review: 1, rejected: 1, approved: 2, commitment_submitted: 3, enrolled: 4 }[reg.status]
}

/** First application, or (with `previous`) the single re-application allowed after a rejection. */
function ApplyForm({ e, onDone, previous }: { e: Election; onDone: () => void; previous?: Registration }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const form = new FormData(ev.currentTarget)
    form.set("consent", form.get("consent") ? "true" : "false")
    setBusy(true)
    setError(null)
    try {
      await post(`/elections/${e.id}/registrations`, form)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title={previous ? "Apply again" : "Apply to vote"}
      icon={previous ? RotateCw : FileUp}
      description={
        previous
          ? "Correct what the officials asked for and upload your ID card again."
          : "Officials use these details only to confirm you're eligible."
      }
    >
      <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
        {previous && (
          <div className="sm:col-span-2">
            <Alert tone="warn" title="This is your last attempt">
              If this application is not approved either, you won&apos;t be able to apply again or vote in this election.
            </Alert>
          </div>
        )}
        {!previous && e.eligible_only && (
          <div className="sm:col-span-2">
            <Alert tone="brand" title="Use your registration number exactly as your institution issued it">
              Only registration numbers on the election office&apos;s voter list can apply. It is linked to your account once you apply.
            </Alert>
          </div>
        )}
        <Field
          id="reg_no"
          label="Registration number"
          hint={previous ? "Linked to your account, so it can't be changed" : "Check it carefully: it is linked to your account once you apply"}
        >
          <Input
            id="reg_no"
            name="reg_no"
            placeholder="e.g. 21CS042"
            required
            minLength={2}
            maxLength={40}
            autoComplete="off"
            defaultValue={previous?.reg_no}
            readOnly={!!previous}
          />
        </Field>
        <Field id="department" label="Department">
          <Input id="department" name="department" placeholder="e.g. Computer Science" required minLength={2} defaultValue={previous?.department} />
        </Field>
        <Field id="year" label="Year of study">
          <Input id="year" name="year" type="number" min={1} max={10} placeholder="1–5" required defaultValue={previous?.year} />
        </Field>
        <Field id="id_document" label="ID card" hint={fileName ?? "PDF, JPG or PNG · up to 5 MB"}>
          <Input
            id="id_document"
            name="id_document"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            required
            onChange={(x) => setFileName(x.target.files?.[0]?.name ?? null)}
          />
        </Field>
        <CheckRow name="consent" required className="sm:col-span-2">
          I consent to election officials viewing my ID card to check that I&apos;m eligible. It is deleted after the results are declared,
          and only what eligibility needs is collected.
        </CheckRow>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="bad">{error}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" busy={busy} size="lg" icon={FileUp}>
            {previous ? "Submit again" : "Submit application"}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function IdentitySetup({ e, reg, onDone }: { e: Election; reg: Registration; onDone: () => void }) {
  const { data: me } = useMe()
  const [code, setCode] = useState("")
  const [sent, setSent] = useState<string | null>(null)
  const [pass, setPass] = useState("")
  const [pass2, setPass2] = useState("")
  const [enc, setEnc] = useState<EncryptedIdentity | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your email")
    if (pass.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters`)
    if (pass !== pass2) return setError("The passphrases do not match")
    setBusy(true)
    try {
      // The emailed code must be correct before the browser creates anything.
      await post(`/registrations/${reg.id}/enrol-code/verify`, { code })
      const sealed = await encryptIdentity(createIdentity(), pass, e.id)
      await saveLocal(sealed)
      setEnc(sealed)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create identity")
    } finally {
      setBusy(false)
    }
  }

  async function submitCommitment() {
    if (!enc) return
    setBusy(true)
    setError(null)
    try {
      await post(`/registrations/${reg.id}/commitment`, { commitment: enc.commitment, enrol_code: code })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit")
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    setSent(null)
    try {
      await post(`/registrations/${reg.id}/enrol-code/resend`)
      setSent("A new code is on its way. Check your inbox (and spam folder).")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a new code")
    }
  }

  return (
    <Card title="You're approved: create your voting identity" icon={KeyRound}>
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: EyeOff, t: "Stays on this device", d: "Your secret key is never sent anywhere." },
            { icon: ShieldCheck, t: "Only a fingerprint leaves", d: "We receive a public commitment, nothing more." },
            { icon: Download, t: "Back it up", d: "Lost keys can't be recovered after the roll is frozen." },
          ].map(({ icon: I, t, d }) => (
            <div key={t} className="rounded-xl bg-subtle p-4">
              <I className="size-5 text-brand" aria-hidden />
              <p className="mt-2 text-sm font-semibold">{t}</p>
              <p className="mt-0.5 text-xs text-muted">{d}</p>
            </div>
          ))}
        </div>

        {!enc ? (
          <form onSubmit={create} className="grid gap-5 sm:grid-cols-2">
            <div className="rounded-xl border border-brand/30 bg-brand-50 p-4 sm:col-span-2">
              <div className="flex flex-wrap items-start gap-3">
                <MailCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-ink">Check your email</p>
                  <p className="text-ink-2">
                    {reg.enrol_code_sent ? "We emailed a 6-digit enrolment code" : "Send yourself a 6-digit enrolment code"} to{" "}
                    <strong>{me?.email ?? "your registered address"}</strong>. It proves this is really you before your voting identity is
                    created.
                  </p>
                </div>
                <Button type="button" variant="secondary" size="sm" icon={RotateCw} onClick={resend}>
                  {reg.enrol_code_sent ? "Resend code" : "Send code"}
                </Button>
              </div>
              {sent && <p className="mt-2 pl-8 text-xs font-medium text-ok">{sent}</p>}
              <div className="mt-4 max-w-xs pl-8">
                <Field id="enrol-code" label="Enrolment code from email" hint="Expires in 48 hours or when registration closes">
                  <Input
                    id="enrol-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="••••••"
                    value={code}
                    onChange={(x) => setCode(x.target.value.replace(/\D/g, ""))}
                    className="text-center font-mono text-xl tracking-[0.5em]"
                  />
                </Field>
              </div>
            </div>
            <Field id="pass" label="Passphrase" hint={`At least ${MIN_PASSPHRASE} characters. You'll need it to vote.`}>
              <Input id="pass" type="password" autoComplete="new-password" value={pass} onChange={(x) => setPass(x.target.value)} />
            </Field>
            <Field id="pass2" label="Repeat passphrase">
              <Input id="pass2" type="password" autoComplete="new-password" value={pass2} onChange={(x) => setPass2(x.target.value)} />
            </Field>
            {error && (
              <div className="sm:col-span-2">
                <Alert tone="bad">{error}</Alert>
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" busy={busy} size="lg" icon={KeyRound}>
                Create identity
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-5">
            <Alert tone="ok" title="Identity created">
              Public fingerprint: <HashChip value={enc.commitment} n={12} />
            </Alert>
            <ol className="space-y-3">
              <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
                <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand">1</span>
                <span className="flex-1 text-sm">
                  <span className="block font-medium">Save your backup card</span>
                  <span className="block text-xs text-muted">An image to keep or print. You need it, with your passphrase, to vote on another device.</span>
                </span>
                <Button
                  variant={downloaded ? "soft" : "primary"}
                  icon={downloaded ? CheckCircle2 : Download}
                  onClick={async () => {
                    try {
                      await downloadBackup(enc, e)
                      setDownloaded(true)
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not create the backup")
                    }
                  }}
                >
                  Download backup card
                </Button>
              </li>
              <li className="flex items-start gap-3 rounded-xl border border-line p-4">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand">2</span>
                <CheckRow disabled={!downloaded} checked={confirmed} onChange={(x) => setConfirmed(x.target.checked)} className="flex-1">
                  I have saved the backup card somewhere safe and I remember my passphrase.
                </CheckRow>
              </li>
            </ol>
            {error && <Alert tone="bad">{error}</Alert>}
            <Button onClick={submitCommitment} disabled={!downloaded || !confirmed} busy={busy} size="lg" icon={ListPlus}>
              Add me to the roll
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

function RollStatus({ e, reg }: { e: Election; reg: Registration }) {
  const enrolled = reg.status === "enrolled"
  return (
    <Card
      title={enrolled ? "On the on-chain roll" : "Adding you to the roll…"}
      icon={enrolled ? CheckCircle2 : Hourglass}
      description={enrolled ? "Your fingerprint is in the public voter roll on chain." : "Your fingerprint is queued for the next on-chain batch."}
    >
      <div className="space-y-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-subtle p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Your fingerprint</p>
            <div className="mt-1.5">
              <HashChip value={reg.commitment} n={12} />
            </div>
          </div>
          <div className="rounded-xl bg-subtle p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Position in roll</p>
            <p className="mt-1.5 text-lg font-bold">{enrolled && reg.member_index !== null ? `#${reg.member_index}` : "Pending"}</p>
          </div>
        </div>
        <p className="text-muted">
          When voting opens, come back to this election and unlock your identity with your passphrase (or your backup card on another device).
        </p>
        {e.phase === "voting" && (
          <ButtonLink href={`/elections/${e.slug}/vote`} size="lg" icon={Vote}>
            Go to the ballot
          </ButtonLink>
        )}
      </div>
    </Card>
  )
}

export default function RegisterPage() {
  const { id } = useParams<{ id: string }>()
  const { data: me, isLoading: meLoading } = useMe()
  const { data: e, isLoading, error } = useElection(id)
  const qc = useQueryClient()
  const regs = useQuery({
    queryKey: ["my-registrations"],
    queryFn: () => get<{ items: Registration[] }>("/me/registrations"),
    enabled: !!me,
    refetchInterval: 4_000,
  })

  if (isLoading || meLoading) return <PageLoader />
  if (error || !e) return <Alert tone="bad" title="Election not found">{error?.message}</Alert>
  if (!me)
    return (
      <EmptyState
        icon={LogIn}
        title="Sign in to register"
        action={<ButtonLink href={`/login?next=/elections/${id}/register`}>Sign in</ButtonLink>}
      >
        You need an account to apply for {e.title}.
      </EmptyState>
    )

  if (isStaff(me))
    return (
      <EmptyState
        icon={LogIn}
        title="Election officials don't register as voters"
        action={<ButtonLink href={`/admin/elections/${e.id}`}>Manage this election</ButtonLink>}
      >
        You are signed in with an official account. Voters register with their own accounts.
      </EmptyState>
    )

  const reg = regs.data?.items.find((r) => r.election_id === e.id)
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-registrations"] })
  const open = e.phase === "pending" || e.phase === "registration"

  return (
    <div>
      <PageHeader
        back={{ href: `/elections/${e.slug}`, label: e.title }}
        eyebrow={e.org}
        title="Register to vote"
        badges={<PhaseBadge phase={e.phase} />}
      />
      <div className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <Stepper steps={STEPS} current={stepOf(reg)} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-6">
          {regs.isLoading && <Spinner />}
          {!regs.isLoading &&
            !reg &&
            (open ? <ApplyForm e={e} onDone={refresh} /> : <Alert tone="warn" title="Registration is closed">This election is no longer accepting applications.</Alert>)}
          {reg?.status === "pending_review" && (
            <Card title="Application under review" icon={Clock}>
              <Alert tone="brand">Your application is with the election officials. This page updates automatically when it&apos;s reviewed.</Alert>
            </Card>
          )}
          {reg?.status === "rejected" && (
            <Card title={reg.can_reapply ? "Application not approved" : "Application not approved again"} icon={XCircle}>
              <div className="space-y-3">
                <Alert tone="bad" title={reg.reject_reason ? `Reason: ${reg.reject_reason}` : undefined}>
                  {reg.can_reapply
                    ? open
                      ? "You can correct this and apply once more below."
                      : "Registration has closed, so you can't apply again."
                    : "This was your last attempt, so you can't apply again or vote in this election. Contact your election office if you think this is a mistake."}
                </Alert>
              </div>
            </Card>
          )}
          {reg?.status === "rejected" && reg.can_reapply && open && <ApplyForm e={e} onDone={refresh} previous={reg} />}
          {reg?.status === "approved" &&
            (open ? (
              <IdentitySetup e={e} reg={reg} onDone={refresh} />
            ) : (
              <Alert tone="warn">Registration closed before you added your identity.</Alert>
            ))}
          {(reg?.status === "commitment_submitted" || reg?.status === "enrolled") && <RollStatus e={e} reg={reg} />}
        </div>

        <aside className="space-y-5">
          <Card title="What happens next">
            <ol className="space-y-4 text-sm">
              {[
                ["Apply", "Upload your ID card with your registration details."],
                ["Review", e.high_stakes ? "Two officials independently approve you." : "An official checks you're eligible."],
                ["Identity", "Your browser creates a secret voting key and you save a backup."],
                ["On the roll", "Your public fingerprint joins the on-chain roll, which is frozen when registration closes."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand">{i + 1}</span>
                  <div>
                    <p className="font-semibold">{t}</p>
                    <p className="text-muted">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Alert tone="accent" title="Your privacy">
            Your ID card is seen only by officials and is deleted after the results. Your ballot can never be linked to this registration.
          </Alert>
          <p className="text-center text-xs text-muted">
            <Link href="/me" className="hover:text-brand">
              See all my registrations →
            </Link>
          </p>
        </aside>
      </div>
    </div>
  )
}
