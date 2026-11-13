"use client"

import Link from "next/link"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { LogIn, MailCheck, ShieldCheck } from "lucide-react"
import { ApiError, post } from "@/lib/api"
import { safeNext, withNext } from "@/lib/next-path"
import type { User } from "@/lib/types"
import { homeFor, useMe } from "@/components/providers"
import { AuthShell } from "@/components/auth-shell"
import { Alert, Button, Field, Input } from "@/components/ui"

type LoginResponse = { user: User | null; code_required?: boolean; email?: string }

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get("next"))
  const justReset = params.get("reset") === "1"
  const qc = useQueryClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  // Officials (super admins, admins, officers) confirm each sign-in with a code sent to their email.
  const [codeFor, setCodeFor] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: me } = useMe()
  useEffect(() => {
    if (me) router.replace(next ?? homeFor(me))
  }, [me, next, router])

  function signedIn(user: User) {
    qc.setQueryData(["me"], user)
    router.push(next ?? homeFor(user))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await post<LoginResponse>("/auth/login", { email, password })
      if (res.code_required) {
        setCodeFor(res.email ?? email)
        setCode("")
        setPassword("")
        return
      }
      if (res.user) signedIn(res.user)
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_not_verified") {
        router.push(`/signup?verify=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`)
        return
      }
      setError(err instanceof Error ? err.message : "Sign-in failed")
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (!codeFor) return
    setBusy(true)
    setError(null)
    try {
      const res = await post<LoginResponse>("/auth/login/code", { email: codeFor, code })
      if (res.user) signedIn(res.user)
    } catch (err) {
      if (err instanceof ApiError && err.code === "login_expired") {
        setCodeFor(null)
        setError("That took too long. Sign in with your password again.")
        return
      }
      setError(err instanceof Error ? err.message : "Could not check the code")
    } finally {
      setBusy(false)
    }
  }

  if (codeFor)
    return (
      <AuthShell title="Confirm it's you" subtitle="Election officials confirm every sign-in with a code from their email.">
        <form onSubmit={confirm} className="space-y-5">
          <Alert tone="brand" title="Check your email">
            We sent a 6-digit code to <strong>{codeFor}</strong>. It expires in 5 minutes.
          </Alert>
          <Field id="login-code" label="Sign-in code">
            <Input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              placeholder="••••••"
              value={code}
              onChange={(x) => setCode(x.target.value.replace(/\D/g, ""))}
              className="text-center font-mono text-2xl tracking-[0.6em]"
            />
          </Field>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button type="submit" busy={busy} icon={ShieldCheck} size="lg" className="w-full" disabled={code.length !== 6}>
            Confirm and sign in
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={MailCheck}
            className="w-full"
            onClick={() => {
              setCodeFor(null)
              setError(null)
            }}
          >
            Use a different account
          </Button>
        </form>
      </AuthShell>
    )

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to register for elections or manage them.">
      <form onSubmit={submit} className="space-y-5">
        {justReset && <Alert tone="ok">Your password has been changed. Sign in with your new password.</Alert>}
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" placeholder="you@college.edu" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          <Field id="password" label="Password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <p className="text-right text-sm">
            <Link className="font-medium text-brand hover:underline" href={email ? `/forgot?email=${encodeURIComponent(email)}` : "/forgot"}>
              Forgot password?
            </Link>
          </p>
        </div>
        {error && <Alert tone="bad">{error}</Alert>}
        <Button type="submit" busy={busy} icon={LogIn} size="lg" className="w-full">
          Sign in
        </Button>
        <p className="text-center text-sm text-muted">
          New here?{" "}
          <Link className="font-semibold text-brand hover:underline" href={withNext("/signup", next)}>
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
