// Thin fetch wrapper. Session cookies are httpOnly; writes carry the CSRF token from the sv_csrf cookie.
// Ballot submission uses `anonymousPost` instead: no cookies, no headers that identify the voter.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return ""
  const m = document.cookie.match(/(?:^|;\s*)sv_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]!) : ""
}

async function parse<T>(res: Response): Promise<T> {
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error
    // A 5xx without our JSON error body comes from the proxy: the API is restarting or unreachable.
    const fallback =
      res.status >= 500
        ? "The server is not responding right now. Nothing was lost; please try again in a moment."
        : `Request failed (${res.status})`
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? fallback)
  }
  return body as T
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? "GET").toUpperCase()
  if (method !== "GET" && method !== "HEAD") headers.set("x-csrf-token", csrfToken())
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json")
  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "same-origin" })
  return parse<T>(res)
}

export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) })
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) })

/** Anonymous request: credentials omitted, so no session cookie can tie the ballot to a login. */
export async function anonymousPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
    cache: "no-store",
  })
  return parse<T>(res)
}
