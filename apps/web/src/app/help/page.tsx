"use client"

import { Mail } from "lucide-react"
import { Faq, HowToVote } from "@/components/help-content"
import { Alert, PageHeader } from "@/components/ui"

export default function HelpPage() {
  return (
    <div className="space-y-14">
      <PageHeader eyebrow="Help" title="How to vote and frequently asked questions" description="Everything you need to take part in an election on SecVote." />
      <HowToVote />
      <Faq />
      <Alert tone="brand" title="Still need help?">
        <span className="inline-flex items-center gap-1.5">
          <Mail className="size-4" aria-hidden /> Contact your institution&apos;s election office. They manage voter approvals and can answer questions about your election.
        </span>
      </Alert>
    </div>
  )
}
