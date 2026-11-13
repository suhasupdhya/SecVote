/** A `?next=` value only if it is a path on this site: browsers treat "//host" and "/\host" as another site. */
export function safeNext(value: string | null | undefined): string | null {
  return value && /^\/(?![/\\])/.test(value) ? value : null
}

/** Append `?next=` to an auth page link, keeping the user's destination across sign-in and sign-up. */
export const withNext = (href: string, next: string | null) => (next ? `${href}?next=${encodeURIComponent(next)}` : href)
