import Link from "next/link"

/** Emblem: a shield holding a ballot tick. Navy with a saffron band; works on light and dark. */
export function LogoMark({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path d="M24 3 42 9.5v13.2c0 11-7.4 19.4-18 22.3C13.400 42.1 6 33.700 6 22.700V9.500L24 3Z" fill="#14336b" />
      <path d="M24 6.200 39 11.600v11.100c0 9.300-6.200 16.500-15 19.200-8.800-2.700-15-9.900-15-19.200V11.600L24 6.200Z" fill="none" stroke="#e8861a" strokeWidth="1.600" />
      <path d="m16.500 24.500 5.200 5.200L32 19.200" fill="none" stroke="#fff" strokeWidth="3.600" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ onDark = false, href = "/" }: { onDark?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3" aria-label="SecVote home">
      <LogoMark />
      <span className="leading-tight">
        <span className={`font-display block text-xl font-bold tracking-tight ${onDark ? "text-white" : "text-ink"}`}>SecVote</span>
        <span className={`block text-[11px] font-semibold uppercase tracking-[0.14em] ${onDark ? "text-white/70" : "text-muted"}`}>
          Secure Electronic Voting
        </span>
      </span>
    </Link>
  )
}
