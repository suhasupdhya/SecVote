"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import type { Identity } from "@semaphore-protocol/core"
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem"
import {
  Ban,
  CheckCircle2,
  Circle,
  CircleSlash,
  Download,
  EyeOff,
  FileKey,
  ListChecks,
  Loader2,
  LockKeyhole,
  ScrollText,
  Send,
  ShieldCheck,
  Ticket,
  Unlock as UnlockIcon,
  Wallet,
} from "lucide-react"
import { ApiError, anonymousPost, get } from "@/lib/api"
import { useElection } from "@/lib/hooks"
import type { Election } from "@/lib/types"
import { ABSTAIN, NOTA, encodeOpen, toHex } from "@/lib/crypto/ballot"
import { encodeSealed, sealBallot, type RaceSpec } from "@secvote/shared"
import { RankRace } from "@/components/rank-race"
import { decryptIdentity, loadLocal, readIdentityBackup, type EncryptedIdentity } from "@/lib/crypto/identity"
import { buildGroup, proveBallot, type ProofPayload } from "@/lib/crypto/proof"
import { chain, electionAbi, readElectionFacts } from "@/lib/chain/client"
import { saveReceipt } from "@/lib/receipts"
import {
  Alert,
  Avatar,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  HashChip,
  Input,
  PageHeader,
  PageLoader,
  PhaseBadge,
  Spinner,
  Stepper,
  cx,
} from "@/components/ui"

type Step = "unlock" | "ballot" | "review" | "proving" | "done"
const STEP_INDEX: Record<Step, number> = { unlock: 0, ballot: 1, review: 2, proving: 3, done: 4 }
type Receipt = { ballotId: string | null; nullifier: string; proof: ProofPayload; ballot: string }
const STAGES = ["Check the roll against the blockchain", "Build your zero-knowledge proof", "Wait a random moment", "Send anonymously"]

function Unlock({ e, onUnlocked }: { e: Election; onUnlocked: (id: Identity) => void }) {
  const [local, setLocal] = useState<EncryptedIdentity | null | undefined>(undefined)
  const [file, setFile] = useState<EncryptedIdentity | null>(null)
  const [pass, setPass] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadLocal(e.id)
      .then((x) => setLocal(x ?? null))
      .catch(() => setLocal(null))
  }, [e.id])

  const enc = file ?? local
  async function unlock(ev: React.FormEvent) {
    ev.preventDefault()
    if (!enc) return
    setBusy(true)
    setError(null)
    try {
      if (enc.electionId !== e.id) throw new Error("That backup belongs to a different election")
      const id = await decryptIdentity(enc, pass)
      // Check the roll now, before the voter fills in a ballot that could never be accepted.
      const roll = await get<{ commitments: string[] }>(`/elections/${e.id}/members`)
      if (!roll.commitments.includes(id.commitment.toString()))
        throw new Error(
          "This identity is not on the voter roll for this election, so it can't vote. This happens when the identity was " +
            "created but not added to the roll (“Add me to the roll”) before registration closed. Contact your election office.",
        )
      onUnlocked(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock")
    } finally {
      setBusy(false)
    }
  }

  if (local === undefined) return <Spinner label="Looking for your identity" />
  return (
    <Card title="Unlock your voting identity" icon={LockKeyhole} description="Unlocking happens entirely in your browser. Nothing is sent.">
      <form onSubmit={unlock} className="max-w-md space-y-5">
        {local ? (
          <Alert tone="ok">Found your identity for this election on this device.</Alert>
        ) : (
          <Field id="backup" label="Backup card" hint="The secvote-identity image you saved when registering (a clear photo of it works too)">
            <Input
              id="backup"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,application/json,.json"
              onChange={async (x) => {
                const f = x.target.files?.[0]
                if (!f) return
                try {
                  setFile(await readIdentityBackup(f))
                  setError(null)
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Invalid file")
                }
              }}
            />
          </Field>
        )}
        <Field id="pass" label="Passphrase">
          <Input id="pass" type="password" autoComplete="current-password" value={pass} onChange={(x) => setPass(x.target.value)} />
        </Field>
        {error && <Alert tone="bad">{error}</Alert>}
        <Button type="submit" busy={busy} disabled={!enc || !pass} size="lg" icon={UnlockIcon}>
          Unlock
        </Button>
      </form>
    </Card>
  )
}

function choiceLabel(e: Election, race: number, c: number) {
  if (c === NOTA) return "None of the above (NOTA)"
  if (c === ABSTAIN) return "Leave blank"
  return e.races[race]!.candidates[c]!.name
}

async function selfSubmit(e: Election, r: Receipt): Promise<string> {
  const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum
  if (!eth) throw new Error("No browser wallet found. Download the proof and submit it from any wallet or relayer.")
  const wallet = createWalletClient({ chain, transport: custom(eth) })
  const [account] = await wallet.requestAddresses()
  return wallet.writeContract({
    account: account!,
    address: e.chain.address as Address,
    abi: electionAbi,
    functionName: "castBallot",
    args: [
      {
        merkleTreeDepth: BigInt(r.proof.merkleTreeDepth),
        merkleTreeRoot: BigInt(r.proof.merkleTreeRoot),
        nullifier: BigInt(r.proof.nullifier),
        message: BigInt(r.proof.message),
        scope: BigInt(r.proof.scope),
        points: r.proof.points.map(BigInt) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
      },
      r.ballot as `0x${string}`,
    ],
  })
}

function downloadProof(e: Election, r: Receipt) {
  const data = { election: e.chain.address, chainId: chain.id, function: "castBallot", proof: r.proof, ballot: r.ballot }
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
  a.download = `secvote-ballot-${e.slug}.json`
  a.click()
}

export default function VotePage() {
  const { id } = useParams<{ id: string }>()
  const { data: e, isLoading, error } = useElection(id)
  const [step, setStep] = useState<Step>("unlock")
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [choices, setChoices] = useState<(number | null)[]>([])
  const [rankings, setRankings] = useState<number[][]>([])
  const [stage, setStage] = useState(0)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [relayError, setRelayError] = useState<string | null>(null)
  const [relayCode, setRelayCode] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [selfTx, setSelfTx] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  // The same identity can only vote once: a second attempt is refused, and sending again would not help.
  const alreadyVoted = relayCode === "already_voted" || relayCode === "already_submitted"

  useEffect(() => {
    if (e && choices.length === 0) {
      setChoices(e.races.map(() => null))
      setRankings(e.races.map(() => []))
    }
  }, [e, choices.length])

  if (isLoading) return <PageLoader />
  if (error || !e) return <Alert tone="bad" title="Election not found">{error?.message}</Alert>

  const header = (
    <PageHeader
      back={{ href: `/elections/${e.slug}`, label: e.title }}
      eyebrow={e.org}
      title="Cast your ballot"
      badges={<PhaseBadge phase={e.phase} />}
    />
  )
  if (e.phase !== "voting" && step !== "done")
    return (
      <div>
        {header}
        <EmptyState icon={CircleSlash} title="Voting is not open" action={<ButtonLink href={`/elections/${e.slug}`} variant="secondary">Back to election</ButtonLink>}>
          Come back during the voting window to cast your ballot.
        </EmptyState>
      </div>
    )
  if (e.chain.paused && step !== "done")
    return (
      <div>
        {header}
        <Alert tone="bad" title="Voting is paused">The election officer has paused voting. Try again shortly.</Alert>
      </div>
    )

  /** Hand the finished ballot to the anonymous relay. Safe to repeat: the same proof can only ever count once. */
  async function send(base: Receipt) {
    if (!e) return
    setRelayError(null)
    setRelayCode(null)
    try {
      const res = await anonymousPost<{ ballot_id: string; nullifier: string }>("/ballots", {
        election_id: e.id,
        proof: base.proof,
        ballot: base.ballot,
      })
      setReceipt({ ...base, ballotId: res.ballot_id })
      saveReceipt({
        ballotId: res.ballot_id,
        nullifier: base.nullifier,
        electionId: e.id,
        electionSlug: e.slug,
        electionTitle: e.title,
        at: new Date().toISOString(),
      })
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : "Relay failed")
      setRelayCode(err instanceof ApiError ? err.code : null)
      setReceipt(base)
    }
  }

  async function prove() {
    if (!identity || !e) return
    setStep("proving")
    setFatal(null)
    setStage(0)
    try {
      const facts = await readElectionFacts(e.chain.address as Address)
      if (!facts.frozen) throw new Error("The roll is not frozen on chain yet.")
      if (facts.scope.toString() !== e.chain.scope) throw new Error("Election scope from the API does not match the chain.")
      const roll = await get<{ commitments: string[] }>(`/elections/${e.id}/members`)
      const group = buildGroup(roll.commitments, facts.frozenRoot.toString())

      setStage(1)
      let ballot: Uint8Array
      if (facts.sealed) {
        // Sealed: encrypt in the browser to the election key read from the chain.
        const specs: RaceSpec[] = e.races.map((r) => ({ candidates: r.candidates.length, method: r.method === "irv" ? "irv" : "plurality" }))
        const sealedChoices = e.races.map((r, i) =>
          r.method === "irv" ? rankings[i]! : choices[i] === ABSTAIN || choices[i] === null ? [] : [choices[i]!],
        )
        ballot = sealBallot(facts.publicKey, encodeSealed(sealedChoices, specs, e.allow_nota))
      } else {
        ballot = encodeOpen(choices as number[])
      }
      const proof = await proveBallot(identity, group, ballot, facts.scope.toString())
      const base: Receipt = { ballotId: null, nullifier: proof.nullifier, proof, ballot: toHex(ballot) }

      // Random delay so the anonymous submission doesn't line up in time with this page load / login.
      setStage(2)
      const delay = 2_000 + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]! % 4_000)
      await new Promise((r) => setTimeout(r, delay))
      setStage(3)
      await send(base)
      setStep("done")
    } catch (err) {
      setFatal(err instanceof Error ? err.message : "Could not build your ballot")
      setStep("review")
    }
  }

  const complete = choices.length > 0 && e.races.every((r, i) => r.method === "irv" || choices[i] !== null)

  return (
    <div>
      {header}
      <div className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <Stepper steps={["Unlock", "Choose", "Review", "Prove & send", "Receipt"]} current={STEP_INDEX[step]} />
      </div>

      {step === "unlock" && (
        <Unlock
          e={e}
          onUnlocked={(i) => {
            setIdentity(i)
            setStep("ballot")
          }}
        />
      )}

      {step === "ballot" && (
        <form
          className="space-y-6"
          onSubmit={(ev) => {
            ev.preventDefault()
            setStep("review")
          }}
        >
          {e.mode === "sealed" && (
            <Alert tone="accent" title="Sealed ballot">
              Your choices are encrypted in this browser before they leave it. Nobody can count any vote until voting has closed and the
              trustees reveal the election key.
            </Alert>
          )}
          {e.races.map((race, ri) =>
            race.method === "irv" ? (
              <RankRace key={race.id} race={race} ranking={rankings[ri] ?? []} onChange={(r) => setRankings((rs) => rs.map((x, i) => (i === ri ? r : x)))} />
            ) : (
            <fieldset key={race.id} className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
              <legend className="sr-only">{race.title}</legend>
              <div className="mb-4 flex items-baseline justify-between gap-3" aria-hidden>
                <h2 className="text-lg font-semibold">{race.title}</h2>
                <span className="text-xs text-muted">Choose one</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ...race.candidates.map((c, ci) => ({ v: ci, label: c.name, kind: "cand" as const })),
                  ...(e.allow_nota ? [{ v: NOTA, label: "None of the above (NOTA)", kind: "nota" as const }] : []),
                  { v: ABSTAIN, label: "Leave blank", kind: "blank" as const },
                ].map((o) => (
                  <label
                    key={o.v}
                    className={cx(
                      "relative flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 transition",
                      "hover:border-brand/60 has-[:checked]:border-brand has-[:checked]:bg-brand-50 has-[:checked]:shadow-[var(--shadow-glow)] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                      o.kind !== "cand" && "border-dashed",
                    )}
                  >
                    <input
                      type="radio"
                      name={`race-${ri}`}
                      value={o.v}
                      required
                      checked={choices[ri] === o.v}
                      onChange={() => setChoices((cs) => cs.map((x, i) => (i === ri ? o.v : x)))}
                      className="peer absolute inset-0 z-10 cursor-pointer appearance-none rounded-xl opacity-0"
                    />
                    {o.kind === "cand" ? (
                      <Avatar name={o.label} />
                    ) : (
                      <span className="grid size-10 place-items-center rounded-full bg-subtle text-muted" aria-hidden>
                        {o.kind === "nota" ? <Ban className="size-4" /> : <Circle className="size-4" />}
                      </span>
                    )}
                    <span className="flex-1 font-medium">{o.label}</span>
                    <CheckCircle2 className="size-5 text-brand opacity-0 transition peer-checked:opacity-100" aria-hidden />
                  </label>
                ))}
              </div>
            </fieldset>
            ),
          )}
          <div className="flex items-center gap-4">
            <Button type="submit" size="lg" disabled={!complete}>
              Review ballot
            </Button>
            {!complete && <p className="text-sm text-muted">Make a choice for every post to continue.</p>}
          </div>
        </form>
      )}

      {step === "review" && (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Card title="Review your ballot" icon={ScrollText} description="Check your choices. You can vote only once.">
            <ul className="divide-y divide-line rounded-xl border border-line">
              {e.races.map((race, ri) => (
                <li key={race.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                  <span className="text-sm text-muted">{race.title}</span>
                  {race.method === "irv" ? (
                    <span className="text-right font-semibold">
                      {rankings[ri]?.length
                        ? rankings[ri]!.map((ci, pos) => `${pos + 1}. ${race.candidates[ci]!.name}`).join("  ·  ")
                        : "Left blank"}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 font-semibold">
                      {choices[ri]! < NOTA && <Avatar name={choiceLabel(e, ri, choices[ri]!)} size="sm" />}
                      {choiceLabel(e, ri, choices[ri]!)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {fatal && (
              <div className="mt-4">
                <Alert tone="bad">{fatal}</Alert>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={prove} size="lg" icon={Send}>
                Confirm and cast ballot
              </Button>
              <Button variant="secondary" size="lg" onClick={() => setStep("ballot")}>
                Change choices
              </Button>
            </div>
          </Card>
          <Card title="What happens when you confirm" icon={ShieldCheck}>
            <ul className="space-y-3 text-sm text-ink-2">
              <li>Your browser checks the voter roll against the blockchain itself.</li>
              <li>It builds a zero-knowledge proof that you&apos;re on the roll, bound to this exact ballot.</li>
              <li>The ballot is sent with no cookies or login, after a random delay.</li>
              <li>A second ballot from your identity is rejected by the contract.</li>
            </ul>
          </Card>
        </div>
      )}

      {step === "proving" && (
        <Card title="Casting your ballot" icon={Loader2} description="Keep this page open. Proof generation can take a few seconds.">
          <ol className="space-y-3">
            {STAGES.map((s, i) => (
              <li
                key={s}
                className={cx(
                  "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition",
                  i === stage ? "border-brand bg-brand-50 font-semibold text-brand" : i < stage ? "border-line text-ink" : "border-line text-muted",
                )}
              >
                {i < stage ? (
                  <CheckCircle2 className="size-5 text-ok" aria-hidden />
                ) : i === stage ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : (
                  <Circle className="size-5" aria-hidden />
                )}
                {s}…
              </li>
            ))}
          </ol>
        </Card>
      )}

      {step === "done" && receipt && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lift)]">
            <div className={cx("px-6 py-6 text-white sm:px-8", receipt.ballotId ? "bg-brand-panel" : "bg-[linear-gradient(135deg,#9a5b07,#5c3504)]")}>
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <Ticket className="size-5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-xl font-bold">{receipt.ballotId ? "Ballot submitted" : alreadyVoted ? "You have already voted" : "Your ballot is ready to send"}</h2>
                  <p className="text-sm text-white/80">{e.title}</p>
                </div>
              </div>
            </div>
            <div className="space-y-5 p-6 sm:p-8">
              {receipt.ballotId ? (
                <Alert tone="ok">Your ballot was handed to the relay. Track it with your receipt ID; it doesn&apos;t reveal who you are.</Alert>
              ) : alreadyVoted ? (
                <Alert tone="bad" title="You have already voted in this election">
                  Each voter can cast one ballot, and your first ballot is the one that counts. It has not been changed. You can check it on
                  the bulletin board or with the receipt on your dashboard.
                </Alert>
              ) : (
                <div className="space-y-3">
                  <Alert tone="warn" title="Your ballot was not sent yet">
                    {relayError} Your ballot is ready and nothing was counted, so you can safely send it again.
                  </Alert>
                  <Button
                    icon={Send}
                    busy={resending}
                    onClick={async () => {
                      setResending(true)
                      await send(receipt)
                      setResending(false)
                    }}
                  >
                    Send again
                  </Button>
                </div>
              )}
              <dl className="grid gap-4 text-sm">
                {receipt.ballotId && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Receipt ID</dt>
                    <dd className="mt-1">
                      <HashChip value={receipt.ballotId} full />
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Nullifier</dt>
                  <dd className="mt-1">
                    <HashChip value={receipt.nullifier} n={14} />
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-3">
                {receipt.ballotId && (
                  <ButtonLink href={`/track/${receipt.ballotId}`} size="lg" icon={Ticket}>
                    Track my ballot
                  </ButtonLink>
                )}
                <ButtonLink variant="secondary" size="lg" href={`/elections/${e.slug}/bulletin`} icon={ScrollText}>
                  Bulletin board
                </ButtonLink>
              </div>
            </div>
          </section>

          {alreadyVoted ? null : receipt.ballotId ? (
            <Card title="What happens next" icon={ListChecks}>
              <ul className="space-y-4 text-sm">
                {[
                  { icon: Ticket, t: "Your receipt is saved on this device", d: "Find it on your dashboard. It shows where your ballot is, never who you are." },
                  { icon: ScrollText, t: "Your ballot joins the public board", d: "It appears on the bulletin board within a few seconds, without your name." },
                  { icon: EyeOff, t: "Nobody can see how you voted", d: "Not the election office, and not SecVote. The count is published after voting closes." },
                ].map(({ icon: I, t, d }) => (
                  <li key={t} className="flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand">
                      <I className="size-4" aria-hidden />
                    </span>
                    <div>
                      <p className="font-semibold">{t}</p>
                      <p className="text-muted">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
          <Card title="Submit it yourself" icon={FileKey} description="Your proof is bound to your exact ballot, so nobody can change it. Anyone can submit it for you.">

            <div className="space-y-3">
              <Button variant="secondary" icon={Download} className="w-full" onClick={() => downloadProof(e, receipt)}>
                Download proof
              </Button>
              <Button
                variant="secondary"
                icon={Wallet}
                className="w-full"
                onClick={async () => {
                  try {
                    setSelfTx(await selfSubmit(e, receipt))
                  } catch (err) {
                    setRelayError(err instanceof Error ? err.message : "Wallet submission failed")
                  }
                }}
              >
                Submit with my wallet
              </Button>
              {selfTx && (
                <Alert tone="ok" title="Sent from your wallet">
                  <HashChip value={selfTx} />
                </Alert>
              )}
            </div>
          </Card>
          )}
        </div>
      )}
    </div>
  )
}
