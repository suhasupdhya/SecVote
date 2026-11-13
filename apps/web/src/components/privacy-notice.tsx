"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Ban, Clock, Database, Eye, Mail, ShieldCheck, UserCog } from "lucide-react"
import { Card, PageHeader } from "@/components/ui"

/** The /privacy page's content (a client component: Card takes icon components). */
function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/90 marker:text-muted">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

export function PrivacyNotice({ institution, contact }: { institution: string; contact?: string }) {
  const INSTITUTION = institution
  const CONTACT = contact
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Privacy"
        title="Privacy notice"
        description={`What SecVote collects, why, who can see it, and how long it is kept. SecVote is run by ${INSTITUTION}, which is responsible for your data.`}
      />

      <Card icon={Database} title="What we collect">
        <List
          items={[
            <>
              <b>Your account:</b> your name and institution email. Your password is stored only as a one-way hash.
            </>,
            <>
              <b>When you register for an election:</b> your register number, department and year, and a photo of your ID card so an
              official can check it.
            </>,
            <>
              <b>The voter register:</b> the election office may upload a list of eligible people (register number, name, email,
              department, year) to approve voters automatically and to send invitations.
            </>,
            <>
              <b>Officials:</b> a record of what each official does (approvals, rejections, election changes), so their actions can be
              audited.
            </>,
          ]}
        />
      </Card>

      <Card icon={Ban} title="What we never collect">
        <List
          items={[
            <>
              <b>How you voted.</b> Your ballot is sent with a zero-knowledge proof that shows you are on the voter roll without saying who
              you are. Nobody, including the election office and SecVote&apos;s operators, can link a ballot to a voter.
            </>,
            <>
              <b>Your voting key and passphrase.</b> They are created in your browser and stay there (and in the backup card you save).
            </>,
            <>
              <b>Aadhaar numbers</b>, or any government ID number.
            </>,
            <>
              <b>Access logs.</b> The site keeps no log of visitors&apos; IP addresses. To stop flooding, the address you vote from is used for
              one minute as a salted hash that cannot be turned back into the address.
            </>,
            <>
              <b>Tracking.</b> No advertising, analytics or third-party trackers. The only cookie is the one that keeps you signed in.
            </>,
          ]}
        />
      </Card>

      <Card icon={Eye} title="Who can see it">
        <List
          items={[
            <>The election office&apos;s officials see your registration and ID card to decide whether you are eligible.</>,
            <>Your email address is used to send sign-in codes, approval or rejection notices, and invitations.</>,
            <>
              The public bulletin board (a blockchain) holds only anonymous data: each voter&apos;s anonymous commitment, the ballots and the
              results. It contains no names, emails or register numbers.
            </>,
            <>Your data is never sold or shared for any other purpose.</>,
          ]}
        />
      </Card>

      <Card icon={Clock} title="How long we keep it">
        <List
          items={[
            <>
              <b>ID card photos</b> are deleted automatically 30 days after the election closes, and sooner when a rejected application is
              replaced.
            </>,
            <>
              <b>Your account</b> is kept until you delete it. Deleting it erases your name, email and password. The register number,
              department and year on your past registrations stay with that election&apos;s record, so the voter roll can still be audited.
            </>,
            <>The anonymous data on the public bulletin board is permanent by design: that is what lets anyone recount the result.</>,
          ]}
        />
      </Card>

      <Card icon={UserCog} title="Your choices">
        <List
          items={[
            <>
              See your details, change your password, or delete your account on{" "}
              <Link className="font-semibold text-brand hover:underline" href="/me">
                My account
              </Link>
              .
            </>,
            <>To correct a registration (for example a wrong register number), contact the election office.</>,
          ]}
        />
      </Card>

      <Card icon={ShieldCheck} title="Questions or complaints">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-ink/90">
          <Mail className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          {CONTACT ? (
            <span>
              Contact <a className="font-semibold text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> about your data or
              this notice.
            </span>
          ) : (
            <span>Contact {INSTITUTION === "your institution" ? "your institution's" : `${INSTITUTION}'s`} election office about your data or this notice.</span>
          )}
        </p>
      </Card>
    </div>
  )
}
