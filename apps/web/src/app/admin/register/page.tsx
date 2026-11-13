"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { BookUser, Download, FileUp, Info, Save, UsersRound } from "lucide-react"
import { get, put } from "@/lib/api"
import { parseRegister, REGISTER_TEMPLATE } from "@/lib/voter-file"
import { downloadExcel, readExcelRows, rowsToText } from "@/lib/excel"
import { RequireAuth } from "@/components/providers"
import { AdminNav } from "@/components/admin-nav"
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Skeleton, Stat, Textarea, fmtDate } from "@/components/ui"
import type { RegisterSummary } from "@/lib/types"

function Register() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["voter-register"], queryFn: () => get<RegisterSummary>("/admin/register") })
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null)
  const rows = parseRegister(text)
  const withEmail = rows.filter((r) => r.email).length
  const data = q.data

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

  async function save() {
    if (data?.count && !confirm(`Replace the whole register (${data.count} people) with ${rows.length} people from this file?`)) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await put<RegisterSummary>("/admin/register", { entries: rows })
      qc.setQueryData(["voter-register"], r)
      setText("")
      setMsg({ tone: "ok", text: `Saved ${r.count} people to the voter register.` })
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not save the register" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Election office"
        title="Voter register"
        description="Everyone who may vote in your institution's elections. Upload it once, update it each term, and give each election its voters in one click."
      />
      <AdminNav />

      {q.isLoading ? (
        <Skeleton className="h-28" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="People on the register" value={data?.count ?? 0} icon={UsersRound} />
          <Stat
            label="With official email"
            value={data?.count ? `${Math.round(((data.with_email ?? 0) / data.count) * 100)}%` : "—"}
            icon={BookUser}
            tone="ok"
            sub={data?.count ? `${data.with_email} of ${data.count}` : undefined}
          />
          <Stat label="Last updated" value={data?.updated_at ? fmtDate(data.updated_at) : "Never"} icon={Info} tone="neutral" />
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[1.3fr_1fr]">
        <Card
          title={data?.count ? "Replace the register" : "Upload the register"}
          icon={FileUp}
          description="Export it from your student or staff records as an Excel file (.xlsx). Saving replaces the whole register."
        >
          <div className="space-y-4">
            <Alert tone="brand" title="Columns">
              Registration number, Email, Name, Department, Year. A header row is recognised automatically. The official email is what
              stops one person registering from a second account, so include it for everyone you can.
            </Alert>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink shadow-sm transition hover:brightness-110">
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
              <Button variant="ghost" size="sm" icon={Download} onClick={() => void downloadExcel(REGISTER_TEMPLATE, "secvote-voter-register-template.xlsx")}>
                Download Excel template
              </Button>
              {text && (
                <span className="text-sm text-muted">
                  {rows.length} {rows.length === 1 ? "person" : "people"} found, {withEmail} with an email
                </span>
              )}
            </div>
            <Field
              id="register-rows"
              label="Or paste rows copied from Excel"
              hint="Rows read from your file appear here too, so you can check or correct them before saving."
            >
              <Textarea
                id="register-rows"
                rows={6}
                value={text}
                onChange={(x) => setText(x.target.value)}
                placeholder={"Registration number\tEmail\tName\tDepartment\tYear\n21CS001\tasha@college.edu\tAsha R\tCSE\t3"}
                className="font-mono text-sm"
              />
            </Field>
            {text && rows.length > 0 && withEmail < rows.length && (
              <Alert tone="warn">
                {rows.length - withEmail} {rows.length - withEmail === 1 ? "person has" : "people have"} no official email. They can still be
                listed, but their registration number isn&apos;t tied to one account.
              </Alert>
            )}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <div className="flex justify-end">
              <Button icon={Save} onClick={save} busy={busy} disabled={rows.length === 0}>
                Save register
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Who is on it" icon={UsersRound} description="By department and year" padded={false}>
          {!data?.count ? (
            <div className="p-5">
              <EmptyState icon={BookUser} title="The register is empty">
                Upload your list to give elections their voters in one click.
              </EmptyState>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-subtle text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">Department</th>
                  <th className="px-5 py-2.5 font-semibold">Year</th>
                  <th className="px-5 py-2.5 text-right font-semibold">People</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.groups.map((g) => (
                  <tr key={`${g.department}-${g.year}`}>
                    <td className="px-5 py-2.5 font-medium">{g.department || <span className="text-muted">Not given</span>}</td>
                    <td className="px-5 py-2.5">{g.year ?? <span className="text-muted">—</span>}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      <Badge>{g.count}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <Register />
    </RequireAuth>
  )
}
