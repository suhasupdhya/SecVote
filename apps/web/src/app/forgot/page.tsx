"use client"

import Link from "next/link"
import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { KeyRound, MailCheck, RotateCw } from "lucide-react"
import { post } from "@/lib/api"
import { AuthShell } from "@/components/auth-shell"
import { Alert, Button, Field, Input, Stepper } from "@/components/ui"

function ForgotFlow() {
  const router = useRouter()
  const params = useSearchParams()
  const [step, setStep] = useState<"email" | "reset">("email")
  const [email, setEmail] = useState(params.get("email") ?? "")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [password2, setPassword2] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  const sendCode = (e?: React.FormEvent) => {
    e?.preventDefault()
    run(async () => {
      await post("/auth/password/forgot", { email })
      setStep("reset")
      setInfo(`If ${email} has a SecVote account, a 6-digit code is on its way. Check your spam folder too.`)
    })
  }

  const reset = (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 10) return setError("Use at least 10 characters")
    if (password !== password2) return setError("The passwords do not match")
    run(async () => {
      await post("/auth/password/reset", { email, code, password })
      router.push(`/login?reset=1`)
    })
  }

  return (
    <AuthShell
      title={step === "email" ? "Forgot your password?" : "Choose a new password"}
      subtitle={step === "email" ? "We'll email you a code to reset it." : "Enter the code from your email and your new password."}
    >
      <div className="mb-8">
        <Stepper steps={["Your email", "New password"]} current={step === "email" ? 0 : 1} />
      </div>
      {step === "email" ? (
        <form onSubmit={sendCode} className="space-y-5">
          <Field id="email" label="Email">
            <Input id="email" type="email" autoComplete="email" placeholder="you@college.edu" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button type="submit" busy={busy} icon={MailCheck} size="lg" className="w-full">
            Email me a code
          </Button>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-5">
          {info && <Alert tone="brand">{info}</Alert>}
          <Field id="code" label="Code from email" hint="6 digits · valid for 5 minutes">
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
          <Field id="password" label="New password" hint="At least 10 characters">
            <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field id="password2" label="Repeat new password">
            <Input id="password2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </Field>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button type="submit" busy={busy} icon={KeyRound} size="lg" className="w-full">
            Reset password
          </Button>
          <Button type="button" variant="ghost" icon={RotateCw} className="w-full" onClick={() => sendCode()} disabled={busy}>
            Send a new code
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link className="font-semibold text-brand hover:underline" href="/login">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}

export default function ForgotPage() {
  return (
    <Suspense>
      <ForgotFlow />
    </Suspense>
  )
}
