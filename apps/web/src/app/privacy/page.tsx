import type { Metadata } from "next"
import { PrivacyNotice } from "@/components/privacy-notice"

export const metadata: Metadata = { title: "Privacy notice" }

// Set at build time (deploy/.env). Without them the notice points voters to their election office.
export default function PrivacyPage() {
  return (
    <PrivacyNotice
      institution={process.env.NEXT_PUBLIC_INSTITUTION_NAME?.trim() || "your institution"}
      contact={process.env.NEXT_PUBLIC_PRIVACY_CONTACT?.trim() || undefined}
    />
  )
}
