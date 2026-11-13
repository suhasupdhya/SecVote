"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Circle, KeyRound, Sparkles, Trash2, UserPlus, Vault } from "lucide-react"
import { toHex } from "viem"
import { encryptTo, newKeyPair, split } from "@secvote/shared"
import { ApiError, api, post } from "@/lib/api"
import type { Election } from "@/lib/types"
import { Alert, Avatar, Badge, Button, Card, Field, HashChip, Input, cx, fmtDate } from "./ui"

/**
 * Sealed elections: three trustees + the key ceremony.
 * The ceremony runs HERE, in the officer's browser: it creates the election key, splits it 2-of-3,
 * encrypts each share to one trustee's own key, and uploads only the public key + encrypted shares.
 */
export function TrusteesCard({ e }: { e: Election }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const trustees = e.trustees ?? []
  const draft = e.status === "draft" || (e.status === "failed" && !e.chain.address)
  const ready = trustees.length === 3 && trustees.every((t) => t.key_registered)
  const refresh = () => qc.invalidateQueries({ queryKey: ["election", e.id, true] })

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    setDone(null)
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  const add = (ev: React.FormEvent) => {
    ev.preventDefault()
    void run("add", async () => {
      await post(`/admin/elections/${e.id}/trustees`, { email })
      setEmail("")
    })
  }

  const ceremony = () =>
    run("ceremony", async () => {
      let { secretKey, publicKey } = newKeyPair()
      const shares = split(secretKey, 2, 3)
      const payload = trustees.map((t) => {
        const s = shares[t.slot - 1]!
        const sealed = encryptTo(t.public_key!, new TextEncoder().encode(JSON.stringify({ x: s.x, y: s.y })))
        return { trustee_id: t.id, encrypted_share: toHex(sealed) }
      })
      secretKey = "" // forget the private key: from now on only 2 trustees together can rebuild it
      await post(`/admin/elections/${e.id}/ceremony`, { public_key: publicKey, shares: payload })
      setDone("Key ceremony complete. The private key existed only in this browser tab and has been discarded.")
    })

  return (
    <Card
      title="Trustees & key ceremony"
      icon={Vault}
      description="Three trustees each hold one share of the election key. Any two can unlock the count after voting closes; nobody can alone."
      action={
        e.chain.public_key ? (
          <Badge tone="ok" dot>
            Ceremony done
          </Badge>
        ) : (
          <Badge tone="warn">{trustees.length}/3 trustees</Badge>
        )
      }
    >
      <div className="space-y-5">
        <ul className="divide-y divide-line rounded-xl border border-line">
          {[1, 2, 3].map((slot) => {
            const t = trustees.find((x) => x.slot === slot)
            return (
              <li key={slot} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand">{slot}</span>
                {t ? (
                  <>
                    <Avatar name={t.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="truncate text-xs text-muted">{t.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {[
                        ["Key", t.key_registered],
                        ["Share", t.share_issued],
                        ["Released", t.share_uploaded],
                      ].map(([label, ok]) => (
                        <span
                          key={label as string}
                          className={cx(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset",
                            ok ? "bg-ok-50 text-ok ring-ok/25" : "bg-subtle text-muted ring-line",
                          )}
                        >
                          {ok ? <CheckCircle2 className="size-3" /> : <Circle className="size-3" />} {label as string}
                        </span>
                      ))}
                    </div>
                    {draft && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        aria-label={`Remove trustee ${t.name}`}
                        busy={busy === `rm-${t.id}`}
                        onClick={() => run(`rm-${t.id}`, () => api(`/admin/elections/${e.id}/trustees/${t.id}`, { method: "DELETE" }))}
                      />
                    )}
                  </>
                ) : (
                  <p className="flex-1 text-sm text-muted">Empty slot</p>
                )}
              </li>
            )
          })}
        </ul>

        {draft && trustees.length < 3 && (
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <Field id="trustee-email" label="Add trustee by email" hint="They must already have a SecVote account" className="min-w-64 flex-1">
              <Input id="trustee-email" type="email" required value={email} onChange={(x) => setEmail(x.target.value)} placeholder="advisor@college.edu" />
            </Field>
            <Button type="submit" variant="secondary" icon={UserPlus} busy={busy === "add"}>
              Add trustee
            </Button>
          </form>
        )}

        {draft && trustees.length === 3 && !ready && (
          <Alert tone="brand">Waiting for every trustee to sign in and create their trustee key on their Trustee page.</Alert>
        )}

        {e.chain.public_key ? (
          <div className="rounded-xl bg-subtle p-4 text-sm">
            <p className="font-semibold">Election public key</p>
            <div className="mt-1">
              <HashChip value={e.chain.public_key} n={12} />
            </div>
            {e.ceremony_at && <p className="mt-1 text-xs text-muted">Ceremony run {fmtDate(e.ceremony_at)}</p>}
          </div>
        ) : null}

        {draft && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={ceremony} disabled={!ready} busy={busy === "ceremony"} icon={e.chain.public_key ? KeyRound : Sparkles}>
              {e.chain.public_key ? "Re-run key ceremony" : "Run key ceremony"}
            </Button>
            <p className="text-xs text-muted">Runs in this browser. The private key is split, encrypted to the trustees and then discarded.</p>
          </div>
        )}
        {done && <Alert tone="ok">{done}</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
    </Card>
  )
}
