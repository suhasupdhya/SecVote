"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Clock, Download, KeyRound, KeySquare, LockKeyhole, ShieldCheck, Unlock, Vault } from "lucide-react"
import { decryptWith } from "@secvote/shared"
import { hexToBytes } from "viem"
import { get, post } from "@/lib/api"
import type { TrusteeElection } from "@/lib/types"
import { RequireAuth } from "@/components/providers"
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckRow,
  EmptyState,
  Field,
  HashChip,
  Input,
  PageHeader,
  PhaseBadge,
  Skeleton,
  Stepper,
  fmtDate,
} from "@/components/ui"
import {
  MIN_PASSPHRASE,
  createTrusteeKey,
  downloadTrusteeKey,
  loadTrusteeKey,
  readTrusteeKeyFile,
  saveTrusteeKey,
  unlockTrusteeKey,
  type SealedTrusteeKey,
} from "@/lib/crypto/trustee-key"

function stepOf(t: TrusteeElection): number {
  if (!t.key_registered) return 0
  if (!t.share_issued) return 1
  if (!t.share_uploaded && !t.key_revealed) return 2
  return 4
}

function CreateKey({ t, onDone }: { t: TrusteeElection; onDone: () => void }) {
  const [pass, setPass] = useState("")
  const [pass2, setPass2] = useState("")
  const [made, setMade] = useState<SealedTrusteeKey | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (pass !== pass2) return setError("The passphrases do not match")
    setBusy(true)
    try {
      const k = await createTrusteeKey(pass, t.election_id)
      await saveTrusteeKey(k)
      setMade(k)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key")
    } finally {
      setBusy(false)
    }
  }

  async function register() {
    if (!made) return
    setBusy(true)
    setError(null)
    try {
      await post(`/trustee/elections/${t.election_id}/key`, { public_key: made.publicKey })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register key")
    } finally {
      setBusy(false)
    }
  }

  if (!made)
    return (
      <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
        <p className="text-sm text-muted sm:col-span-2">
          Your browser creates a personal trustee key. Your share of the election key will be locked to it, so only you can open it.
        </p>
        <Field id={`tp-${t.slot}`} label="Trustee passphrase" hint={`At least ${MIN_PASSPHRASE} characters`}>
          <Input id={`tp-${t.slot}`} type="password" autoComplete="new-password" value={pass} onChange={(x) => setPass(x.target.value)} />
        </Field>
        <Field id={`tp2-${t.slot}`} label="Repeat trustee passphrase">
          <Input id={`tp2-${t.slot}`} type="password" autoComplete="new-password" value={pass2} onChange={(x) => setPass2(x.target.value)} />
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="bad">{error}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" busy={busy} icon={KeyRound}>
            Create trustee key
          </Button>
        </div>
      </form>
    )

  return (
    <div className="space-y-4">
      <Alert tone="ok" title="Trustee key created">
        Public key: <HashChip value={made.publicKey} n={10} />
      </Alert>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={saved ? "soft" : "primary"}
          icon={saved ? CheckCircle2 : Download}
          onClick={async () => {
            try {
              await downloadTrusteeKey(made, t, t.slot)
              setSaved(true)
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not create the backup")
            }
          }}
        >
          Download trustee key backup
        </Button>
      </div>
      <CheckRow checked={saved} disabled={!saved} onChange={() => {}}>
        I have stored the backup safely. Without it and my passphrase, my share can never be opened.
      </CheckRow>
      {error && <Alert tone="bad">{error}</Alert>}
      <Button onClick={register} disabled={!saved} busy={busy} icon={ShieldCheck}>
        Register my trustee key
      </Button>
    </div>
  )
}

function ReleaseShare({ t, onDone }: { t: TrusteeElection; onDone: () => void }) {
  const [local, setLocal] = useState<SealedTrusteeKey | null | undefined>(undefined)
  const [file, setFile] = useState<SealedTrusteeKey | null>(null)
  const [pass, setPass] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ released: number; needed: number; reconstructed: boolean; error?: string } | null>(null)

  useEffect(() => {
    loadTrusteeKey(t.election_id)
      .then((k) => setLocal(k ?? null))
      .catch(() => setLocal(null))
  }, [t.election_id])

  const key = file ?? local
  async function release(ev: React.FormEvent) {
    ev.preventDefault()
    if (!key) return
    setBusy(true)
    setError(null)
    try {
      const sk = await unlockTrusteeKey(key, pass)
      const { encrypted_share } = await get<{ encrypted_share: string }>(`/trustee/elections/${t.election_id}/share`)
      // Decrypt the share HERE, in the browser, then release it (accepted only after voting has closed).
      const share = JSON.parse(new TextDecoder().decode(decryptWith(sk, hexToBytes(encrypted_share as `0x${string}`)))) as {
        x: number
        y: string
      }
      setResult(await post(`/trustee/elections/${t.election_id}/share`, share))
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release share")
    } finally {
      setBusy(false)
    }
  }

  if (local === undefined) return <Skeleton className="h-24" />
  return (
    <form onSubmit={release} className="max-w-lg space-y-4">
      <p className="text-sm text-muted">Voting has closed. Unlock your trustee key to decrypt your share and release it so the votes can be counted.</p>
      {local ? (
        <Alert tone="ok">Found your trustee key on this device.</Alert>
      ) : (
        <Field id={`tk-file-${t.slot}`} label="Trustee key backup card" hint="The secvote-trustee-key image you saved (a clear photo of it works too)">
          <Input
            id={`tk-file-${t.slot}`}
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,application/json,.json"
            onChange={async (x) => {
              const f = x.target.files?.[0]
              if (!f) return
              try {
                setFile(await readTrusteeKeyFile(f))
              } catch (err) {
                setError(err instanceof Error ? err.message : "Invalid file")
              }
            }}
          />
        </Field>
      )}
      <Field id={`tk-pass-${t.slot}`} label="Trustee passphrase">
        <Input id={`tk-pass-${t.slot}`} type="password" autoComplete="current-password" value={pass} onChange={(x) => setPass(x.target.value)} />
      </Field>
      {error && <Alert tone="bad">{error}</Alert>}
      {result && (
        <Alert tone={result.error ? "bad" : "ok"} title={result.reconstructed ? "Election key rebuilt" : "Share released"}>
          {result.error ??
            (result.reconstructed
              ? "Enough trustees have released their shares. The key is being published on chain and the votes will be counted."
              : `${result.released} of ${result.needed} shares released. Waiting for another trustee.`)}
        </Alert>
      )}
      <Button type="submit" busy={busy} disabled={!key || !pass} icon={Unlock}>
        Release my share
      </Button>
    </form>
  )
}

function TrusteeCard({ t, onChange }: { t: TrusteeElection; onChange: () => void }) {
  const closed = t.phase === "closed"
  return (
    <Card
      title={t.title}
      description={`${t.org} · Trustee #${t.slot}`}
      icon={Vault}
      action={
        <div className="flex gap-2">
          {t.phase ? <PhaseBadge phase={t.phase} /> : <Badge>{t.status}</Badge>}
          {t.key_revealed && (
            <Badge tone="ok" dot>
              Key revealed
            </Badge>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        <Stepper steps={["Your key", "Ceremony", "After close", "Released"]} current={stepOf(t)} />
        {!t.key_registered && t.status === "draft" && <CreateKey t={t} onDone={onChange} />}
        {!t.key_registered && t.status !== "draft" && <Alert tone="bad">This election was published before you registered a key.</Alert>}
        {t.key_registered && !t.share_issued && (
          <Alert tone="brand" title="Waiting for the key ceremony">
            Your key is registered. The election officer will run the ceremony and lock your share to it.
          </Alert>
        )}
        {t.share_issued && !closed && !t.key_revealed && (
          <Alert tone="brand" title="Your share is ready, but locked until voting closes">
            {t.status === "published" ? `Come back after voting closes (scheduled ${fmtDate(t.vote_end)}).` : "The election hasn't been published yet."}{" "}
            Keep your trustee key backup and passphrase safe.
          </Alert>
        )}
        {t.share_issued && closed && !t.share_uploaded && !t.key_revealed && <ReleaseShare t={t} onDone={onChange} />}
        {(t.share_uploaded || t.key_revealed) && (
          <Alert tone="ok" title={t.key_revealed ? "Done: the key is public and votes can be counted" : "Your share is released"}>
            {t.key_revealed ? (
              <>
                Anyone can now <Link className="font-semibold underline" href={`/elections/${t.slug}/verify`}>verify the count</Link>.
              </>
            ) : (
              "Waiting for one more trustee."
            )}
          </Alert>
        )}
      </div>
    </Card>
  )
}

function TrusteeHome() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["trustee-elections"],
    queryFn: () => get<{ items: TrusteeElection[] }>("/trustee/elections"),
    refetchInterval: 5_000,
  })
  return (
    <div>
      <PageHeader
        eyebrow="Trustee"
        title="Election key trustee"
        description="You hold one of three shares of a sealed election's key. Any two trustees together can unlock the count after voting closes; no one can alone."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: KeySquare, t: "Your key stays with you", d: "Created in your browser and protected by your passphrase." },
          { icon: LockKeyhole, t: "Locked until close", d: "The server can't release your share before voting ends." },
          { icon: ShieldCheck, t: "2 of 3 needed", d: "No single person, including you, can count votes early." },
        ].map(({ icon: I, t, d }) => (
          <div key={t} className="rounded-2xl border border-line bg-surface p-4">
            <I className="size-5 text-brand" aria-hidden />
            <p className="mt-2 text-sm font-semibold">{t}</p>
            <p className="text-xs text-muted">{d}</p>
          </div>
        ))}
      </div>
      {isLoading && <Skeleton className="h-48" />}
      {error && <Alert tone="bad">{error.message}</Alert>}
      {data?.items.length === 0 && (
        <EmptyState icon={Clock} title="You aren't a trustee for any election yet">
          The election office will add you when they set up a sealed election.
        </EmptyState>
      )}
      <div className="space-y-5">
        {data?.items.map((t) => (
          <TrusteeCard key={t.election_id} t={t} onChange={() => qc.invalidateQueries({ queryKey: ["trustee-elections"] })} />
        ))}
      </div>
    </div>
  )
}

export default function TrusteePage() {
  return (
    <RequireAuth roles={["trustee"]}>
      <TrusteeHome />
    </RequireAuth>
  )
}
