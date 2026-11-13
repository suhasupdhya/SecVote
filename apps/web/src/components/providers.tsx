"use client"

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { ShieldAlert } from "lucide-react"
import { ApiError, get, post } from "@/lib/api"
import type { Role, User } from "@/lib/types"
import { EmptyState, PageLoader, ButtonLink } from "./ui"

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** The signed-in user, or null. /auth/me answers {user: null} when signed out (and clears stale cookies). */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => (await get<{ user: User | null }>("/auth/me")).user,
    staleTime: 30_000,
  })
}

export const isStaff = (u: User | null | undefined) => !!u?.roles.some((r) => r === "admin" || r === "officer")

/** Where a user lands after signing in: officials get the admin console, everyone else their dashboard. */
export const homeFor = (u: User) => (isStaff(u) ? "/admin" : "/dashboard")

export function useSignOut() {
  const qc = useQueryClient()
  const router = useRouter()
  return useCallback(async () => {
    await post("/auth/logout").catch(() => null)
    // Reset the cached user *in place* so every mounted component (e.g. the header) re-renders as signed out,
    // then drop everything else that belonged to the old session.
    qc.setQueryData(["me"], null)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" })
    router.push("/login")
  }, [qc, router])
}

/** Client-side guard for signed-in pages. UX only: the API enforces auth and roles on every request. */
export function RequireAuth({ children, roles, voter }: { children: ReactNode; roles?: Role[]; voter?: boolean }) {
  const { data: me, isLoading } = useMe()
  const router = useRouter()
  const pathname = usePathname()
  // `voter` pages (dashboard etc.) are not for election officials: send them to their console.
  const wrongSide = !!voter && isStaff(me)

  useEffect(() => {
    if (!isLoading && me === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`)
    else if (wrongSide) router.replace("/admin")
  }, [isLoading, me, pathname, router, wrongSide])

  if (isLoading || !me || wrongSide) return <PageLoader />
  if (roles && !me.roles.some((r) => roles.includes(r)))
    return (
      <EmptyState icon={ShieldAlert} title="You don't have access to this page" action={<ButtonLink href={homeFor(me)}>Go to my dashboard</ButtonLink>}>
        This area is for election officials only.
      </EmptyState>
    )
  return <>{children}</>
}
