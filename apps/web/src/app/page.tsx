"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  Building,
  Eye,
  EyeOff,
  Fingerprint,
  GraduationCap,
  Landmark,
  Lock,
  School,
  ShieldCheck,
  UserPlus,
} from "lucide-react"
import { homeFor, useMe } from "@/components/providers"
import { LogoMark } from "@/components/brand"
import { ButtonLink, PageLoader } from "@/components/ui"
import { Faq, HowToVote, SectionTitle } from "@/components/help-content"


const AUDIENCES = [
  { icon: School, t: "Schools", d: "Student council, house captain and class representative elections." },
  { icon: GraduationCap, t: "Colleges and universities", d: "Students' union, department, hostel and club elections." },
  { icon: Landmark, t: "Government and public bodies", d: "Committee, association, society and staff-body elections." },
  { icon: Building, t: "Organisations", d: "Board, union, alumni and residents' association elections." },
]

const GUARANTEES = [
  { icon: EyeOff, t: "Secret ballot", d: "Nobody, including the people running the election, can see how you voted." },
  { icon: Fingerprint, t: "One person, one vote", d: "A second ballot from the same voter is automatically rejected." },
  { icon: ShieldCheck, t: "Locked voter roll", d: "The roll is frozen when registration closes. Nobody can be added afterwards." },
  { icon: Blocks, t: "Rules that cannot be bent", d: "Registration and voting times are enforced by a smart contract, not by a server." },
  { icon: Eye, t: "Public bulletin board", d: "Every ballot is published the moment it is recorded, so nothing can quietly disappear." },
  { icon: BadgeCheck, t: "Recountable result", d: "Anyone can recount the result from public data and compare it with the declared one." },
]



/** Hero illustration: the emblem and what happens to a ballot. Static: the landing page shows no election data. */
function HeroEmblem() {
  const steps = [
    { icon: Lock, t: "Sealed in your browser", d: "Your choice is protected before it leaves your device." },
    { icon: Blocks, t: "Recorded on a public ledger", d: "Every ballot is published; none can quietly disappear." },
    { icon: BadgeCheck, t: "Recountable by anyone", d: "The declared result can be checked independently." },
  ]
  return (
    <div className="relative hidden lg:block" aria-hidden>
      <div className="absolute -right-16 -top-20 size-80 rounded-full bg-white/5" />
      <div className="absolute -bottom-24 right-24 size-56 rounded-full bg-saffron/10" />
      <div className="relative rounded-2xl bg-white/[0.07] p-7 ring-1 ring-white/15 backdrop-blur-sm">
        <div className="flex items-center gap-4 border-b border-white/15 pb-5">
          <LogoMark className="size-16" />
          <div>
            <p className="font-display text-2xl font-bold">Your vote, protected</p>
            <p className="text-sm text-white/70">From the moment you choose to the final count</p>
          </div>
        </div>
        <ol className="mt-5 space-y-4">
          {steps.map(({ icon: I, t, d }, i) => (
            <li key={t} className="flex gap-3.5">
              <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
                <I className="size-5 text-saffron" />
                <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-saffron text-[10px] font-bold text-navy">
                  {i + 1}
                </span>
              </span>
              <div>
                <p className="font-semibold">{t}</p>
                <p className="text-sm text-white/70">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export default function Home() {
  const { data: me, isLoading: meLoading } = useMe()
  const router = useRouter()
  useEffect(() => {
    if (me) router.replace(homeFor(me))
  }, [me, router])
  const secondary = "bg-white/10 text-white ring-1 ring-inset ring-white/30 hover:bg-white/20"
  if (meLoading || me) return <PageLoader />

  return (
    <div className="space-y-20">
      {/* ------------------------------------------------------------ hero */}
      <section className="bg-brand-panel -mt-2 overflow-hidden rounded-2xl text-white shadow-[var(--shadow-lift)]">
        <div className="grid items-center gap-10 px-6 py-12 sm:px-10 lg:grid-cols-[1.2fr_1fr] lg:py-16">
          <div className="animate-fade-up space-y-6">
            <p className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider ring-1 ring-white/20">
              <ShieldCheck className="size-3.5 text-saffron" aria-hidden /> Secure online voting
            </p>
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Every vote secret.
              <br />
              Every result <span className="text-saffron">verifiable</span>.
            </h1>
            <p className="max-w-xl text-lg text-white/80">
              SecVote conducts elections for schools, colleges and public institutions. Only verified voters can vote, nobody can see how you
              voted, and anyone can recount the result.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg" variant="accent" iconRight={ArrowRight}>
                Register as a voter
              </ButtonLink>
              <ButtonLink href="/login" size="lg" variant="ghost" className={secondary}>
                Sign in
              </ButtonLink>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-sm text-white/75">
              {["Secret ballot", "One person, one vote", "Independently recountable"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <BadgeCheck className="size-4 text-saffron" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroEmblem />
        </div>
      </section>

      <HowToVote />

      {/* ------------------------------------------------------------ who it is for */}
      <section aria-labelledby="who" className="space-y-8">
        <SectionTitle eyebrow="Who it is for" title="Built for institutions that must get elections right" id="who" />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map(({ icon: I, t, d }) => (
            <li key={t} className="rounded-2xl border border-line border-t-[3px] border-t-brand bg-surface p-6 shadow-[var(--shadow-card)]">
              <I className="size-7 text-brand" aria-hidden />
              <p className="mt-3 text-lg font-bold">{t}</p>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ safeguards */}
      <section aria-labelledby="trust" className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-10">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <SectionTitle eyebrow="Safeguards" title="Security you do not have to take on trust" id="trust">
            Each safeguard is enforced by cryptography or by the election contract on a public blockchain, not by a promise.
          </SectionTitle>
          <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {GUARANTEES.map(({ icon: I, t, d }) => (
              <li key={t} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand">
                  <I className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-bold">{t}</p>
                  <p className="mt-1 text-sm text-muted">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Faq />

      {/* ------------------------------------------------------------ closing call to action */}
      {(
        <section className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-line border-l-4 border-l-saffron bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Ready to vote in your next election?</h2>
            <p className="mt-1 text-muted">Register once with your institution email. Your election office will confirm your eligibility.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup" size="lg" icon={UserPlus}>
              Register as a voter
            </ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">
              Sign in
            </ButtonLink>
          </div>
        </section>
      )}
    </div>
  )
}
