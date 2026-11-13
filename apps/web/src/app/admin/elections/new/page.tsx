"use client"

import { RequireAuth } from "@/components/providers"
import { AdminNav } from "@/components/admin-nav"
import { CreateElection } from "@/components/create-election-form"
import { PageHeader } from "@/components/ui"

export default function NewElectionPage() {
  return (
    <RequireAuth roles={["admin"]}>
      <PageHeader
        back={{ href: "/admin", label: "Admin console" }}
        eyebrow="Election office"
        title="New election"
        description="Saved as a draft. Nothing is public until you publish, and the published setup can't be changed."
      />
      <AdminNav />
      <CreateElection />
    </RequireAuth>
  )
}
