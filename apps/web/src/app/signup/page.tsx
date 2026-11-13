"use client"

import Link from "next/link"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MailCheck, RotateCw, UserPlus } from "lucide-react"
import { get, post } from "@/lib/api"
import { safeNext, withNext } from "@/lib/next-path"
import { homeFor, useMe } from "@/components/providers"
import type { User } from "@/lib/types"
import { AuthShell } from "@/components/auth-shell"
import { Alert, Button, Field, Input, Stepper } from "@/components/ui"

function strength(p: string): { score: number; label: string } {
  let s = 0
  if (p.length >= 10) s++
  if (p.length >= 14) s++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
  if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) s++
  return { score: s, label: ["Too short", "Weak", "Okay", "Good", "Strong"][s]! }
}

function SignupFlow() {
  const params = useSearchParams()
  const next = safeNext(params.get("next"))
  const router = useRouter()
  const qc = useQueryClient()
  const [step, setStep] = useState<"form" | "otp">(params.get("verify") ? "otp" : "form")
  const [email, setEmail] = useState(params.get("verify") ?? "")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pw = strength(password)
  const { data: me } = useMe()
  const cfg = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => get<{ allowed_email_domains: string[] }>("/auth/config"),
    staleTime: Infinity,
  })
  const domains = cfg.data?.allowed_email_domains ?? []
  const domainOk = !email.includes("@") || domains.length === 0 || domains.includes(email.split("@").pop()!.toLowerCase())
  const domainHint = domains.length ? `Allowed: ${domains.map((d) => "@" + d).join(", ")}` : "Use your college or organisation address"
  useEffect(() => {
    if (me && step === "form") router.replace(next ?? homeFor(me))
  }, [me, step, next, router])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const register = (e: React.FormEvent) => {
    e.preventDefault()
    if (!domainOk) return // the email field already explains which domains are allowed
    run(async () => {
      await post("/auth/register", { email, name, password })
      setStep("otp")
      setInfo(`We sent a 6-digit code to ${email}.`)
    })
  }
  const verify = (e: React.FormEvent) => {
    e.preventDefault()
    run(async () => {
      const { user } = await post<{ user: User }>("/auth/otp/verify", { email, code })
      qc.setQueryData(["me"], user)
      router.push(next ?? homeFor(user))
    })
  }
  const resend = () =>
    run(async () => {
      await post("/auth/otp/request", { email })
      setInfo("A new code is on its way.")
    })

  return (
    <AuthShell
      title={step === "otp" ? "Check your inbox" : "Create your account"}
      subtitle={step === "otp" ? "Enter the code we emailed you to verify your address." : "Use your college or organisation email address."}
    >
      <div className="mb-8">
        <Stepper steps={["Account", "Verify email"]} current={step === "otp" ? 1 : 0} />
      </div>
      {step === "otp" ? (
        <form onSubmit={verify} className="space-y-5">
          {info && <Alert tone="brand">{info}</Alert>}
          <Field id="otp-email" label="Email">
            <Input id="otp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="code" label="Verification code" hint="6 digits · valid for 5 minutes">
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center font-mono text-2xl tracking-[0.6em]"
            />
          </Field>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button type="submit" busy={busy} icon={MailCheck} size="lg" className="w-full">
            Verify and continue
          </Button>
          <Button type="button" variant="ghost" icon={RotateCw} className="w-full" onClick={resend} disabled={busy || !email}>
            Send a new code
          </Button>
        </form>
      ) : (
        <form onSubmit={register} className="space-y-5">
          <Field id="name" label="Full name">
            <Input id="name" autoComplete="name" placeholder="Priya Raman" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="email" label="Institution email" hint={domainHint} error={domainOk ? undefined : `Use an address ending in ${domains.map((d) => "@" + d).join(" or ")}`}>
            <Input id="email" type="email" autoComplete="email" placeholder="you@college.edu" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="password" label="Password">
            <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {password && (
            <div className="-mt-2 space-y-1.5">
              <div className="flex gap-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full ${i < pw.score ? (pw.score >= 3 ? "bg-ok" : "bg-warn") : "bg-subtle"}`} />
                ))}
              </div>
              <p className="text-xs text-muted">
                Strength: {pw.label}
                {password.length < 10 && " · at least 10 characters"}
              </p>
            </div>
          )}
          <p className="rounded-xl bg-subtle p-3 text-xs text-muted">
            We store your name and email only to run elections. We never store Aadhaar numbers, and you can delete your account at any time.
          </p>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button type="submit" busy={busy} icon={UserPlus} size="lg" className="w-full">
            Create account
          </Button>
          <p className="text-center text-sm text-muted">
            Already registered?{" "}
            <Link className="font-semibold text-brand hover:underline" href={withNext("/login", next)}>
              Sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupFlow />
    </Suspense>
  )
}
