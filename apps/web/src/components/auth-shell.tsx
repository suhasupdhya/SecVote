import type { ReactNode } from "react"
import { BadgeCheck, EyeOff, Fingerprint, ShieldCheck } from "lucide-react"
import { LogoMark } from "./brand"

const POINTS = [
  { icon: EyeOff, t: "Your ballot is secret", d: "Not even the election office can see how you voted." },
  { icon: Fingerprint, t: "One person, one vote", d: "Enforced by cryptography and the election contract." },
  { icon: BadgeCheck, t: "Results you can check", d: "Every ballot is public and the count can be recounted by anyone." },
  { icon: ShieldCheck, t: "Minimal data", d: "No Aadhaar numbers are stored. You can delete your account at any time." },
]

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lift)] lg:grid-cols-[1fr_1.15fr]">
      <aside className="bg-brand-panel relative hidden flex-col justify-between gap-10 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="size-11" />
          <div className="leading-tight">
            <p className="font-display text-xl font-bold">SecVote</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Secure Electronic Voting</p>
          </div>
        </div>
        <div className="space-y-6">
          <h2 className="text-3xl font-bold leading-tight">
            Cast your vote with confidence.
            <span className="mt-3 block h-[3px] w-14 bg-saffron" aria-hidden />
          </h2>
          <ul className="space-y-4 text-sm text-white/80">
            {POINTS.map(({ icon: I, t, d }) => (
              <li key={t} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/20">
                  <I className="size-4 text-saffron" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold text-white">{t}</p>
                  <p>{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="border-t border-white/15 pt-4 text-xs text-white/60">For schools, colleges and public institutions.</p>
      </aside>
      <div className="p-6 sm:p-10 lg:p-12">
        <div className="mx-auto max-w-sm animate-fade-up">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">Voter services</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}
