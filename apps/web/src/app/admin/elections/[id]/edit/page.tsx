"use client"

import { useParams } from "next/navigation"
import { Lock } from "lucide-react"
import { useElection } from "@/lib/hooks"
import { RequireAuth } from "@/components/providers"
import { AdminNav } from "@/components/admin-nav"
import { CreateElection } from "@/components/create-election-form"
import { Alert, ButtonLink, EmptyState, PageHeader, PageLoader } from "@/components/ui"

function EditDraft() {
  const { id } = useParams<{ id: string }>()
  const { data: e, isLoading, error } = useElection(id, { admin: true })
  if (isLoading) return <PageLoader />
  if (error || !e) return <Alert tone="bad" title="Not found">{error?.message}</Alert>
  const editable = e.status === "draft" || e.status === "failed"
  return (
    <>
      <PageHeader
        back={{ href: `/admin/elections/${e.id}`, label: e.title }}
        eyebrow="Election office"
        title="Edit draft"
        description="Change anything you need before publishing. Once published, the setup is locked on chain."
      />
      <AdminNav />
      {editable ? (
        <CreateElection initial={e} />
      ) : (
        <EmptyState icon={Lock} title="This election can't be edited" action={<ButtonLink href={`/admin/elections/${e.id}`}>Back to the election</ButtonLink>}>
          It has been published, so its setup is fixed on chain.
        </EmptyState>
      )}
    </>
  )
}

export default function EditElectionPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <EditDraft />
    </RequireAuth>
  )
}
