"use client"

import { useQuery } from "@tanstack/react-query"
import { BadgeCheck, ScrollText, ShieldAlert } from "lucide-react"
import { api } from "@/lib/api"
import { RequireAuth } from "@/components/providers"
import { AdminNav } from "@/components/admin-nav"
import { Alert, Card, HashChip, PageHeader, Skeleton, fmtDate } from "@/components/ui"

type Event = {
  seq: number
  actor: string
  action: string
  target: string
  data: Record<string, unknown>
  at: string
  hash: string
}

const LABEL: Record<string, string> = {
  bootstrap_admin: "First admin created",
  grant_role: "Role granted",
  revoke_role: "Role removed",
  "election.create": "Election drafted",
  "election.update": "Election edited",
  "election.publish": "Election published",
  "election.delete_draft": "Draft deleted",
  "election.freeze": "Voter roll frozen",
  "election.pause": "Voting paused",
  "election.unpause": "Voting resumed",
  "election.end_registration": "Registration closed early",
  "election.start_voting": "Voting opened early",
  "election.end_voting": "Voting closed early",
  "election.declare_result": "Result declared",
  "election.key_ceremony": "Key ceremony run",
  "election.key_reconstructed": "Election key rebuilt",
  "registration.approve": "Voter approved",
  "registration.reject": "Voter rejected",
  "registration.reapply": "Voter re-applied",
  "registration.auto_approve": "Voter approved from voter list",
  "registration.reset_request": "Passphrase reset requested",
  "registration.reset_approve": "Passphrase reset approved",
  "registration.reset_decline": "Passphrase reset declined",
  "registration.reset_replace": "Voting identity replaced",
  "registration.reg_no_conflict": "Blocked: registration number already used by another account",
  "registration.email_mismatch": "Blocked: email differs from the voter list",
  "election.eligibility": "Voter list updated",
  "election.eligibility_from_register": "Voter list taken from the register",
  "election.invite": "Invitations sent",
  "register.replace": "Voter register uploaded",
  "role.grant": "Role granted",
  "role.revoke": "Role removed",
  "role.request": "Promotion requested",
  "role.request_cancel": "Promotion declined",
  "role.owner_assigned": "Super admin assigned",
  "user.reset_password": "Password reset",
  "user.change_password": "Password changed",
  "registration.view_document": "ID card viewed",
  "trustee.add": "Trustee added",
  "trustee.remove": "Trustee removed",
  "trustee.register_key": "Trustee key registered",
  "trustee.release_share": "Trustee share released",
  "user.delete": "Account deleted",
  "cli.reset_password": "Password reset (operator)",
}

function Audit() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ chain_valid: boolean; items: Event[] }>("/admin/audit?limit=300"),
    refetchInterval: 10_000,
  })
  return (
    <div>
      <PageHeader
        eyebrow="Election office"
        title="Audit log"
        description="Every action by an official, in order. Each entry is chained to the one before it by a hash, so altering or deleting any entry breaks the chain."
      />
      <AdminNav />
      {error && <Alert tone="bad">{error.message}</Alert>}
      {data && (
        <div className="mb-6">
          {data.chain_valid ? (
            <Alert tone="ok" title="Integrity check passed">
              All {data.items.length} entries shown are intact and correctly chained.
            </Alert>
          ) : (
            <Alert tone="bad" title="Integrity check failed">
              One or more entries have been altered or removed. Investigate before trusting this log.
            </Alert>
          )}
        </div>
      )}
      <Card title="Entries" icon={data?.chain_valid === false ? ShieldAlert : ScrollText} padded={false}>
        {isLoading ? (
          <div className="p-5">
            <Skeleton className="h-60" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-subtle text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">#</th>
                  <th className="px-5 py-3 font-semibold">When</th>
                  <th className="px-5 py-3 font-semibold">Action</th>
                  <th className="px-5 py-3 font-semibold">By</th>
                  <th className="px-5 py-3 font-semibold">Details</th>
                  <th className="px-5 py-3 font-semibold">Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.items.map((ev) => (
                  <tr key={ev.seq} className="align-top hover:bg-subtle/60">
                    <td className="px-5 py-3 tabular-nums text-muted">{ev.seq}</td>
                    <td className="whitespace-nowrap px-5 py-3">{fmtDate(ev.at)}</td>
                    <td className="px-5 py-3 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <BadgeCheck className="size-3.5 text-ok" aria-hidden />
                        {LABEL[ev.action] ?? ev.action}
                      </span>
                    </td>
                    <td className="px-5 py-3">{ev.actor}</td>
                    <td className="max-w-xs px-5 py-3 text-xs text-muted">
                      <span className="mono">{ev.target}</span>
                      {Object.keys(ev.data).length > 0 && (
                        <span className="mt-0.5 block break-words">
                          {Object.entries(ev.data)
                            .map(([k, v]) => `${k}: ${typeof v === "string" && v.length > 24 ? v.slice(0, 12) + "…" : String(v)}`)
                            .join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <HashChip value={ev.hash} n={6} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

export default function AuditPage() {
  return (
    <RequireAuth roles={["admin", "observer"]}>
      <Audit />
    </RequireAuth>
  )
}
