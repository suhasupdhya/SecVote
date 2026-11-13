"use client"

import { ChevronDown, KeyRound, ScanSearch, UserPlus, Vote } from "lucide-react"

const STEPS = [
  { icon: UserPlus, t: "Register", d: "Create an account with your institution email and upload your ID card. An election official confirms you are eligible." },
  { icon: KeyRound, t: "Create your voting identity", d: "Your device creates a secret voting key protected by your passphrase. It never leaves your device." },
  { icon: Vote, t: "Cast your ballot", d: "When voting opens, mark your choices. Your device proves you are on the roll without revealing who you are." },
  { icon: ScanSearch, t: "Check and verify", d: "Use your receipt to confirm your ballot was recorded, and recount the declared result yourself." },
]

const FAQ = [
  {
    q: "Can anyone find out how I voted?",
    a: "No. Your device proves that you are an eligible voter without saying which voter you are. The election office, the server and anyone reading the public record see a valid ballot, not your name.",
  },
  {
    q: "How do I know my vote was counted?",
    a: "After voting you receive a receipt. Use it on the ballot tracker to see your ballot on the public bulletin board. Once results are declared, the Verify page recounts every ballot in your own browser.",
  },
  {
    q: "What if I forget my passphrase or lose my device?",
    a: "Your voting identity is protected by your passphrase and saved on a backup card (an image) when you register. Keep both safe: nobody, including the election office, can recover them for you once the voter roll is locked.",
  },
  {
    q: "Who decides who is allowed to vote?",
    a: "Election officials check each application and ID card. Approved voters get a one-time code by email to finish enrolling.",
  },
  {
    q: "What are sealed ballots and trustees?",
    a: "In a sealed election every ballot is encrypted on your device. Three trustees each hold part of the key, and any two must come together after voting closes before a single vote can be counted.",
  },
]

export function SectionTitle({ eyebrow, title, id, children }: { eyebrow: string; title: string; id: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <h2 id={id} className="rule-saffron mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {children && <p className="mt-3 text-muted">{children}</p>}
    </div>
  )
}

/** "How to vote" in four steps. Used on the landing page and the Help page. */
export function HowToVote() {
  return (
  <section id="how" aria-labelledby="how-title" className="scroll-mt-28 space-y-8">
    <SectionTitle eyebrow="How to vote" title="Four steps from registration to a verified result" id="how-title" />
    <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
      {STEPS.map(({ icon: I, t, d }, i) => (
        <li key={t} className="relative rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3">
            <span className="font-display grid size-10 place-items-center rounded-full bg-brand text-lg font-bold text-brand-ink">{i + 1}</span>
            <I className="size-5 text-accent" aria-hidden />
          </div>
          <p className="mt-4 text-lg font-bold">{t}</p>
          <p className="mt-1.5 text-sm text-muted">{d}</p>
        </li>
      ))}
    </ol>
  </section>
  )
}

/** Frequently asked questions. Used on the landing page and the Help page. */
export function Faq() {
  return (
  <section id="faq" aria-labelledby="faq-title" className="scroll-mt-28 space-y-8">
    <SectionTitle eyebrow="Help" title="Frequently asked questions" id="faq-title" />
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      {FAQ.map(({ q, a }) => (
        <details key={q} className="group px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown className="size-5 shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          <p className="max-w-3xl pb-5 text-sm text-ink-2">{a}</p>
        </details>
      ))}
    </div>
  </section>
  )
}
