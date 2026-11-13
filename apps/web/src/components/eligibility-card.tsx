"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BookUser, Download, FileUp, ListChecks, Mail, Save, Send, UsersRound } from "lucide-react"
import { get, post, put } from "@/lib/api"
import type { Election, RegisterSummary } from "@/lib/types"
import { downloadExcel, readExcelRows, rowsToText } from "@/lib/excel"
import { LIST_TEMPLATE, cells } from "@/lib/voter-file"
import { Alert, Badge, Button, Card, CheckRow, Field, Textarea, cx } from "./ui"

type Eligibility = {
  count: number
  with_email: number
  eligible_only: boolean
  editable: boolean
  auto_approve: boolean
  auto_approved?: number
  invitations?: { invited: number; applied: number; not_applied: number; can_invite: number; can_send: boolean }
}

/** Email everyone on the list who hasn't registered yet. Pressing again later works as a reminder. */
function Invitations({ e, status, onSent }: { e: Election; status: NonNullable<Eligibility["invitations"]>; onSent: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null)
  async function send() {
    if (!confirm(`Email an invitation to ${status.can_invite} ${status.can_invite === 1 ? "person" : "people"} who haven't registered yet?`)) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await post<{ queued: number }>(`/admin/elections/${e.id}/invitations`)
      setMsg({ tone: "ok", text: `Sending ${r.queued} invitation${r.queued === 1 ? "" : "s"}. The counts update as they go out.` })
      onSent()
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not send invitations" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="size-4 text-brand" aria-hidden /> Invitations
        </p>
        <p className="text-xs text-muted">
          {status.invited} invited · {status.applied} registered · {status.not_applied} not yet
        </p>
      </div>
      {status.can_send ? (
        <>
          <Button variant="secondary" icon={Send} onClick={send} busy={busy} disabled={status.can_invite === 0}>
            {status.can_invite > 0
              ? `Email ${status.can_invite} ${status.can_invite === 1 ? "person" : "people"} who haven't registered`
              : status.not_applied === 0
                ? "Everyone on the list has registered"
                : "Nobody to invite right now"}
          </Button>
          <p className="text-xs text-muted">
            Each invitation links to sign-up and this election. People emailed in the last 12 hours are skipped, so you can press it
            again later as a reminder. People without an email on the list can&apos;t be invited.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted">
          {e.status === "published" ? "Registration has closed." : "Publish the election to send invitations: voters can't see it before then."}
        </p>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  )
}
export type ListEntry = { reg_no: string; email?: string; name?: string }

/**
 * Rows from an Excel sheet or pasted from Excel: registration number first, then optionally the official email and name
 * in any order (the cell with "@" is the email). Header rows are skipped; repeated numbers are merged.
 */
export function parseVoterList(text: string): ListEntry[] {
  const out = new Map<string, ListEntry>()
  for (const line of text.split(/\r?\n/)) {
    const row = cells(line)
    const reg = row[0]?.replace(/\s+/g, " ").toUpperCase()
    if (!reg || /^(REG|REGISTRATION|ROLL|ID\b|S\.?\s?NO)/.test(reg)) continue
    const rest = row.slice(1).filter(Boolean)
    const email = rest.find((c) => c.includes("@"))?.toLowerCase()
    const name = rest.find((c) => !c.includes("@"))
    const prev = out.get(reg)
    out.set(reg, { reg_no: reg, email: email ?? prev?.email, name: name ?? prev?.name })
  }
  return [...out.values()]
}

/** Pick this election's voters from the institution's register: everyone, or some departments and years. */
function FromRegister({
  e,
  restrict,
  onSaved,
}: {
  e: Election
  restrict: boolean
  onSaved: (r: Eligibility, n: number) => void
}) {
  const reg = useQuery({ queryKey: ["voter-register"], queryFn: () => get<RegisterSummary>("/admin/register") })
  const [depts, setDepts] = useState<string[]>([])
  const [years, setYears] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const groups = reg.data?.groups ?? []
  if (reg.isLoading) return null
  if (!groups.length)
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
        <BookUser className="mb-1 size-5 text-brand" aria-hidden />
        Upload your institution&apos;s{" "}
        <Link href="/admin/register" className="font-semibold text-brand hover:underline">
          voter register
        </Link>{" "}
        once, and every election can take its voters from it in one click.
      </div>
    )
  const allDepts = [...new Set(groups.map((g) => g.department))].sort((a, b) => a.localeCompare(b))
  const allYears = [...new Set(groups.map((g) => g.year).filter((y): y is number => y !== null))].sort((a, b) => a - b)
  const count = groups
    .filter((g) => (!depts.length || depts.includes(g.department)) && (!years.length || (g.year !== null && years.includes(g.year))))
    .reduce((s, g) => s + g.count, 0)
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const chip = (on: boolean) =>
    cx(
      "rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset transition",
      on ? "bg-brand text-brand-ink ring-brand" : "bg-surface text-ink-2 ring-line-strong hover:ring-brand",
    )

  async function use() {
    setBusy(true)
    setError(null)
    try {
      const r = await post<Eligibility>(`/admin/elections/${e.id}/eligibility/from-register`, {
        departments: depts.length ? depts : null,
        years: years.length ? years : null,
        eligible_only: restrict,
      })
      onSaved(r, count)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use the register")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl bg-subtle/60 p-4 ring-1 ring-inset ring-line">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <BookUser className="size-4 text-brand" aria-hidden /> From the voter register
      </p>
      <div className="space-y-2">
        <p className="text-xs text-muted">Departments {depts.length ? "" : "(all)"}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Departments">
          {allDepts.map((d) => (
            <button key={d || "none"} type="button" aria-pressed={depts.includes(d)} className={chip(depts.includes(d))} onClick={() => setDepts(toggle(depts, d))}>
              {d || "No department"}
            </button>
          ))}
        </div>
      </div>
      {allYears.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted">Years {years.length ? "" : "(all)"}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Years">
            {allYears.map((y) => (
              <button key={y} type="button" aria-pressed={years.includes(y)} className={chip(years.includes(y))} onClick={() => setYears(toggle(years, y))}>
                Year {y}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <Alert tone="bad">{error}</Alert>}
      <Button icon={UsersRound} onClick={use} busy={busy} disabled={count === 0}>
        Use {count} voter{count === 1 ? "" : "s"} from the register
      </Button>
    </div>
  )
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
  const parsed = parseVoterList(text)
  const parsedEmails = parsed.filter((x) => x.email).length
  const restrict = only ?? data?.eligible_only ?? false

  /** `regNos` null keeps the current list and only changes the setting. */
  async function save(regNos: ListEntry[] | null, eligibleOnly: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await put<Eligibility>(`/admin/elections/${e.id}/eligibility`, { entries: regNos, eligible_only: eligibleOnly })
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
    if (f.size > 10 * 1024 * 1024) return setMsg({ tone: "bad", text: "That file is larger than 10 MB" })
    setMsg(null)
    try {
      setText(rowsToText(await readExcelRows(f)))
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not read that file" })
    }
  }

  if (!data || (!data.editable && data.count === 0)) return null
  return (
    <Card
      title="Voter list"
      icon={ListChecks}
      description="Upload your institution's list. Applicants on it are approved without manual review, and adding official emails stops one person applying from a second account."
      action={<Badge tone={data.count ? "ok" : "neutral"}>{data.count ? `${data.count} on the list` : "No list"}</Badge>}
    >
      <div className="space-y-4">
        {!data.auto_approve && (
          <Alert tone="brand">This election needs two officials per voter, so listed applicants are marked &ldquo;On list&rdquo; but still reviewed.</Alert>
        )}
        {data.count > 0 && (
          <p className="text-sm text-muted">
            {data.with_email === data.count
              ? "Every number on the list is linked to an official email, so each can only be used by that account."
              : data.with_email > 0
                ? `${data.with_email} of ${data.count} numbers are linked to an official email.`
                : "No official emails on the list yet. Add them so a registration number can only be used from its owner's account."}
          </p>
        )}
        {data.count > 0 && data.invitations && (
          <Invitations
            e={e}
            status={data.invitations}
            onSent={() => {
              // sending runs in the background: refresh the counts a few times
              for (const ms of [1500, 5000, 15000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ["eligibility", e.id] }), ms)
            }}
          />
        )}
        {data.count > 0 && data.eligible_only && (
          <Alert tone="warn">Only registration numbers on the list can apply. Anyone else is turned away with a message to contact you.</Alert>
        )}
        {data.editable ? (
          <>
            <FromRegister
              e={e}
              restrict={restrict}
              onSaved={async (r, n) => {
                qc.setQueryData(["eligibility", e.id], r)
                await qc.invalidateQueries({ queryKey: ["review", e.id] })
                setOnly(null)
                setMsg({
                  tone: "ok",
                  text: `Took ${n} voter${n === 1 ? "" : "s"} from the register.${r.auto_approved ? ` ${r.auto_approved} waiting applicant${r.auto_approved === 1 ? " was" : "s were"} approved.` : ""}`,
                })
              }}
            />
            <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted">
              <span className="h-px flex-1 bg-line" /> or paste a list for this election only <span className="h-px flex-1 bg-line" />
            </p>
            <Field
              id="regnos"
              label={data.count ? "Replace the list" : "Registration numbers"}
              hint="Upload an Excel file, or paste rows copied from Excel: registration number, then official email and name (optional)."
            >
              <Textarea id="regnos" rows={4} placeholder={"21CS001, asha@college.edu, Asha R\n21CS002, bala@college.edu, Bala K"} value={text} onChange={(x) => setText(x.target.value)} className="font-mono text-sm" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-line-strong px-3 text-sm font-semibold transition hover:border-brand hover:text-brand">
                <FileUp className="size-4" aria-hidden /> Upload Excel file
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  aria-label="Upload Excel file"
                  onChange={(x) => {
                    void readFile(x.target.files?.[0])
                    x.target.value = ""
                  }}
                />
              </label>
              <Button variant="ghost" size="sm" icon={Download} onClick={() => void downloadExcel(LIST_TEMPLATE, "secvote-voter-list-template.xlsx")}>
                Excel template
              </Button>
              {text && (
                <span className="text-sm text-muted">
                  {parsed.length} registration number{parsed.length === 1 ? "" : "s"} found
                  {parsedEmails > 0 && `, ${parsedEmails} with an email`}
                </span>
              )}
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
