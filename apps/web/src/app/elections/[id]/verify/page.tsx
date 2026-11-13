"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { BadgeCheck, Blocks, Calculator, CircleAlert, FileCode2, KeyRound, Loader2, PlayCircle, ScanSearch, Terminal } from "lucide-react"
import type { Address } from "viem"
import { verifyElection, type VerifyReport } from "@secvote/shared"
import { publicClient } from "@/lib/chain/client"
import { useElection } from "@/lib/hooks"
import { Alert, Badge, Button, Card, HashChip, PageHeader, PageLoader, PhaseBadge, cx } from "@/components/ui"

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545"

export default function VerifyPage() {
  const { id } = useParams<{ id: string }>()
  const { data: e, isLoading, error } = useElection(id)
  const [log, setLog] = useState<string[]>([])
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [running, setRunning] = useState(false)
  const [fail, setFail] = useState<string | null>(null)
  const started = useRef(false) // React dev mode runs effects twice; recount once

  const run = useCallback(async () => {
    if (!e?.chain.address) return
    setRunning(true)
    setFail(null)
    setReport(null)
    setLog([])
    try {
      const r = await verifyElection(publicClient, e.chain.address as Address, {
        fromBlock: e.chain.deploy_block ? BigInt(e.chain.deploy_block) : 0n,
        onProgress: (m) => setLog((l) => [...l, m]),
      })
      setReport(r)
    } catch (err) {
      setFail(err instanceof Error ? err.message : "Verification failed")
    } finally {
      setRunning(false)
    }
  }, [e?.chain.address, e?.chain.deploy_block])

  useEffect(() => {
    if (e?.chain.address && !started.current) {
      started.current = true
      void run()
    }
  }, [e?.chain.address, run])

  if (isLoading) return <PageLoader />
  if (error || !e) return <Alert tone="bad" title="Election not found">{error?.message}</Alert>

  const ok = report?.matches
  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: `/elections/${e.slug}/bulletin`, label: "Bulletin board & results" }}
        eyebrow={e.org}
        title="Verify it yourself"
        description="Your browser recounts this election from the blockchain alone. It doesn't trust SecVote's servers for anything."
        badges={<PhaseBadge phase={e.phase} />}
        actions={
          <Button variant="secondary" onClick={run} busy={running} icon={PlayCircle}>
            Run again
          </Button>
        }
      />

      <section
        className={cx(
          "flex flex-wrap items-center gap-4 rounded-2xl p-6 ring-1 ring-inset",
          running && "bg-brand-50 ring-brand/20",
          !running && ok && "bg-ok-50 ring-ok/25",
          !running && report && !ok && "bg-warn-50 ring-warn/25",
          fail && "bg-bad-50 ring-bad/25",
        )}
      >
        <span
          className={cx(
            "grid size-14 place-items-center rounded-2xl text-white shadow-md",
            running ? "bg-brand" : ok ? "bg-ok" : fail ? "bg-bad" : "bg-warn",
          )}
        >
          {running ? <Loader2 className="size-7 animate-spin" /> : ok ? <BadgeCheck className="size-7" /> : <CircleAlert className="size-7" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold" data-testid="verify-verdict">
            {running
              ? "Recounting…"
              : fail
                ? "Verification could not run"
                : ok
                  ? "Verified: the declared result matches every ballot on chain"
                  : report
                    ? "Not verified yet"
                    : "Ready"}
          </p>
          <p className="text-sm text-muted">
            {fail ??
              (report
                ? ok
                  ? `Recounted ${report.ballots} ballot${report.ballots === 1 ? "" : "s"} independently. The hash matches the one the election officer published on chain.`
                  : report.notes.join(" ") || "The recomputed hash differs from the declared one."
                : log[log.length - 1] ?? "Starting…")}
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {report?.result && (
            <Card title="Independent recount" icon={Calculator} description="Candidate names come from the election page; every number comes from the chain.">
              <div className="space-y-5">
                {report.result.races.map((r, i) => {
                  const race = e.races[i]
                  const counts = r.method === "irv" ? r.rounds[r.rounds.length - 1]!.counts : r.counts
                  return (
                    <div key={i}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="font-semibold">{race?.title ?? `Post ${i + 1}`}</p>
                        <Badge tone={r.method === "irv" ? "accent" : "neutral"}>{r.method === "irv" ? `Ranked · ${r.rounds.length} round${r.rounds.length === 1 ? "" : "s"}` : "Plurality"}</Badge>
                      </div>
                      <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                        {counts.map((c, ci) => (
                          <li key={ci} className={cx("flex justify-between px-3 py-2", r.winner === ci && "font-semibold")}>
                            <span>
                              {race?.candidates[ci]?.name ?? `Candidate ${ci + 1}`}
                              {r.winner === ci && <span className="ml-2 text-xs text-ok">winner</span>}
                            </span>
                            <span className="tabular-nums">{c}</span>
                          </li>
                        ))}
                        <li className="flex justify-between px-3 py-2 text-muted">
                          <span>{r.method === "plurality" ? "NOTA · blank · invalid" : "Blank · invalid"}</span>
                          <span className="tabular-nums">
                            {r.method === "plurality" ? `${r.nota} · ` : ""}
                            {r.abstain} · {r.invalid}
                          </span>
                        </li>
                      </ul>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          <Card title="Hashes" icon={FileCode2}>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Recomputed in your browser</dt>
                <dd className="mt-1">
                  <HashChip value={report?.computedHash} n={14} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Declared on chain</dt>
                <dd className="mt-1">
                  <HashChip value={report?.declaredHash} n={14} />
                </dd>
              </div>
            </dl>
            {report?.canonical && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-brand">Show the exact result that was hashed</summary>
                <pre className="mono mt-2 max-h-64 overflow-auto rounded-xl bg-subtle p-3 whitespace-pre-wrap">{report.canonical}</pre>
              </details>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title="What your browser just did" icon={ScanSearch}>
            <ol className="space-y-3 text-sm">
              {[
                { icon: Blocks, t: "Read the contract", d: "Posts, counting rules, the revealed key and the declared hash." },
                { icon: ScanSearch, t: "Fetched every ballot", d: "All BallotCast events, straight from the blockchain node." },
                { icon: KeyRound, t: e.mode === "sealed" ? "Decrypted each ballot" : "Decoded each ballot", d: e.mode === "sealed" ? "With the election key the trustees published after close." : "Open ballots are stored as plain choices." },
                { icon: Calculator, t: "Counted and hashed", d: "Using the published rules, then compared with the declared hash." },
              ].map(({ icon: I, t, d }, i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand">
                    <I className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="font-semibold">
                      {i + 1}. {t}
                    </p>
                    <p className="text-muted">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            {log.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-xl bg-subtle p-3 text-xs text-muted">
                {log.map((m, i) => (
                  <li key={i}>• {m}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Don't trust this page either?" icon={Terminal}>
            <p className="text-sm text-muted">Run the standalone verifier. It needs only a blockchain RPC URL and the contract address.</p>
            <pre className="mono mt-3 overflow-x-auto rounded-xl bg-subtle p-3 whitespace-pre-wrap">
              pnpm --filter @secvote/verifier verify --rpc {RPC_URL} --election {e.chain.address ?? "<address>"}
            </pre>
          </Card>
        </aside>
      </div>
    </div>
  )
}
