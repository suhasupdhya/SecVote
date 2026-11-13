"use client"

import Link from "next/link"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { LogIn } from "lucide-react"
import { ApiError, post } from "@/lib/api"
import { safeNext, withNext } from "@/lib/next-path"
import type { User } from "@/lib/types"
import { homeFor, useMe } from "@/components/providers"
import { AuthShell } from "@/components/auth-shell"
import { Alert, Button, Field, Input } from "@/components/ui"

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get("next"))
  const justReset = params.get("reset") === "1"
  const qc = useQueryClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: me } = useMe()
  useEffect(() => {
    if (me) router.replace(next ?? homeFor(me))
  }, [me, next, router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { user } = await post<{ user: User }>("/auth/login", { email, password })
      qc.setQueryData(["me"], user)
      router.push(next ?? homeFor(user))
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
