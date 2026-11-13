"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FileUp, ListChecks, Save } from "lucide-react"
import { get, put } from "@/lib/api"
import type { Election } from "@/lib/types"
import { Alert, Badge, Button, Card, CheckRow, Field, Textarea } from "./ui"

type Eligibility = { count: number; eligible_only: boolean; editable: boolean; auto_approve: boolean; auto_approved?: number }

/** Registration numbers from pasted text or a CSV: the first column of each line, header rows skipped. */
export function parseRegNos(text: string): string[] {
  const out = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const first = line.split(/[,;\t]/)[0]!.replace(/^"|"$/g, "").trim()
    if (!first || /^(reg|registration|roll|id|s\.?\s?no)/i.test(first)) continue
    out.add(first.replace(/\s+/g, " ").toUpperCase())
  }
  return [...out]
}

/** Pre-approved voters: the office uploads its list of registration numbers; matching applicants are approved automatically. */
export function EligibilityCard({ e }: { e: Election }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["eligibility", e.id], queryFn: () => get<Eligibility>(`/admin/elections/${e.id}/eligibility`) })
  const [text, setText] = useState("")
  const [only, setOnly] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null)
  const data = q.data
  const parsed = parseRegNos(text)
  const restrict = only ?? data?.eligible_only ?? false

  /** `regNos` null keeps the current list and only changes the setting. */
  async function save(regNos: string[] | null, eligibleOnly: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await put<Eligibility>(`/admin/elections/${e.id}/eligibility`, { reg_nos: regNos, eligible_only: eligibleOnly })
      qc.setQueryData(["eligibility", e.id], r)
      await qc.invalidateQueries({ queryKey: ["review", e.id] })
      setText("")
      setOnly(null)
      setMsg({
        tone: "ok",
        text:
          regNos === null
            ? r.eligible_only
              ? "Only people on the list can apply now."
              : "Anyone with an allowed email can apply now."
            : regNos.length === 0
            ? "The list has been cleared."
            : `Saved ${r.count} registration number${r.count === 1 ? "" : "s"}.${r.auto_approved ? ` ${r.auto_approved} waiting applicant${r.auto_approved === 1 ? " was" : "s were"} approved.` : ""}`,
      })
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not save the list" })
    } finally {
      setBusy(false)
    }
  }

  async function readFile(f: File | undefined) {
    if (!f) return
    if (f.size > 5 * 1024 * 1024) return setMsg({ tone: "bad", text: "That file is larger than 5 MB" })
    setText(await f.text())
  }

  if (!data || (!data.editable && data.count === 0)) return null
  return (
    <Card
      title="Voter list"
      icon={ListChecks}
      description="Upload your institution's registration numbers. Applicants on the list are approved without manual review."
      action={<Badge tone={data.count ? "ok" : "neutral"}>{data.count ? `${data.count} on the list` : "No list"}</Badge>}
    >
      <div className="space-y-4">
        {!data.auto_approve && (
          <Alert tone="brand">This election needs two officials per voter, so listed applicants are marked &ldquo;On list&rdquo; but still reviewed.</Alert>
        )}
        {data.count > 0 && data.eligible_only && (
          <Alert tone="warn">Only registration numbers on the list can apply. Anyone else is turned away with a message to contact you.</Alert>
        )}
        {data.editable ? (
          <>
            <Field id="regnos" label={data.count ? "Replace the list" : "Registration numbers"} hint="One per line, or upload a CSV/text file (the first column is used)">
              <Textarea id="regnos" rows={4} placeholder={"21CS001\n21CS002\n21CS003"} value={text} onChange={(x) => setText(x.target.value)} className="font-mono text-sm" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm font-semibold transition hover:border-brand hover:text-brand">
                <FileUp className="size-4" aria-hidden /> Upload file
                <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(x) => readFile(x.target.files?.[0])} />
              </label>
              {text && <span className="text-sm text-muted">{parsed.length} registration number{parsed.length === 1 ? "" : "s"} found</span>}
            </div>
            <CheckRow checked={restrict} onChange={(x) => setOnly(x.target.checked)}>
              <span className="font-semibold text-ink">Only people on the list can apply</span>
              <span className="block text-xs text-muted">Otherwise anyone with an allowed email can apply, and people not on the list are reviewed by hand.</span>
            </CheckRow>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <div className="flex flex-wrap justify-end gap-2">
              {data.count > 0 && (
                <Button variant="ghost" onClick={() => save([], false)} busy={busy}>
                  Clear list
                </Button>
              )}
              {text ? (
                <Button icon={Save} onClick={() => save(parsed, restrict)} busy={busy} disabled={parsed.length === 0}>
                  Save list
                </Button>
              ) : (
                data.count > 0 &&
                restrict !== data.eligible_only && (
                  <Button variant="secondary" icon={Save} onClick={() => save(null, restrict)} busy={busy}>
                    Save setting
                  </Button>
                )
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">Registration has closed, so the list can no longer change.</p>
        )}
      </div>
    </Card>
  )
}
