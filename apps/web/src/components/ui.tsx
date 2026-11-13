"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react"
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, Info, Loader2, XCircle, type LucideProps } from "lucide-react"
import type { Phase } from "@/lib/types"

export type Icon = ComponentType<LucideProps>
export const cx = (...c: unknown[]) => c.filter(Boolean).join(" ")

// ------------------------------------------------------------------ buttons
type Variant = "primary" | "secondary" | "danger" | "ghost" | "soft" | "accent"
type Size = "sm" | "md" | "lg"
const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink shadow-sm hover:bg-brand-600",
  secondary: "bg-surface text-ink border border-line-strong hover:border-brand hover:text-brand",
  danger: "bg-bad text-white shadow-sm hover:opacity-90",
  ghost: "text-ink-2 hover:bg-subtle hover:text-ink",
  soft: "bg-brand-50 text-brand hover:bg-brand-100",
  accent: "bg-saffron text-[#1c1202] shadow-sm hover:bg-saffron-600",
}
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm gap-1.5",
  md: "min-h-11 px-4 text-sm gap-2",
  lg: "min-h-12 px-6 text-base gap-2",
}
const btnBase =
  "inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50"

export function Button({
  variant = "primary",
  size = "md",
  className,
  busy,
  icon: I,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean; icon?: Icon }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(btnBase, variants[variant], sizes[size], className)}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : I ? <I className="size-4" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon: I,
  iconRight: IR,
  children,
  className,
}: {
  href: string
  variant?: Variant
  size?: Size
  icon?: Icon
  iconRight?: Icon
  children: ReactNode
  className?: string
}) {
  return (
    <Link href={href} className={cx(btnBase, variants[variant], sizes[size], className)}>
      {I && <I className="size-4" aria-hidden />}
      {children}
      {IR && <IR className="size-4" aria-hidden />}
    </Link>
  )
}

// ------------------------------------------------------------------ layout
export function Card({
  children,
  className,
  title,
  description,
  icon: I,
  action,
  padded = true,
}: {
  children?: ReactNode
  className?: string
  title?: ReactNode
  description?: ReactNode
  icon?: Icon
  action?: ReactNode
  padded?: boolean
}) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]", className)}>
      {(title || action) && (
        <header
          className={cx(
            "flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6",
            padded && children !== undefined && "border-b border-line",
          )}
        >
          <div className="flex items-center gap-3">
            {I && (
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-brand-ink">
                <I className="size-5" aria-hidden />
              </span>
            )}
            <div>
              {title && <h2 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      {children !== undefined && <div className={cx(padded && "p-5 sm:p-6")}>{children}</div>}
    </section>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
  badges,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
  badges?: ReactNode
}) {
  return (
    <header className="mb-8 animate-fade-up space-y-3 border-b border-line pb-6">
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-brand">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            {badges}
          </div>
          {description && <p className="max-w-2xl text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  )
}

// ------------------------------------------------------------------ forms
export function Field({
  label,
  hint,
  error,
  children,
  id,
  className,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  id: string
  className?: string
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p className="flex items-center gap-1 text-xs font-medium text-bad" role="alert">
          <XCircle className="size-3.5" aria-hidden /> {error}
        </p>
      )}
    </div>
  )
}

const inputCls =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink shadow-sm transition placeholder:text-muted/70 hover:border-muted focus:border-brand focus:shadow-[var(--shadow-glow)] focus:outline-none disabled:opacity-60 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand"
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, "pr-8", p.className)} />

export function CheckRow({ children, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-subtle/60 p-3.5 text-sm text-ink-2 transition hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-50",
        p.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input type="checkbox" {...p} className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" />
      <span>{children}</span>
    </label>
  )
}

// ------------------------------------------------------------------ status
export type Tone = "neutral" | "ok" | "warn" | "bad" | "brand" | "accent"
const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2 ring-line-strong",
  ok: "bg-ok-50 text-ok ring-ok/25",
  warn: "bg-warn-50 text-warn ring-warn/25",
  bad: "bg-bad-50 text-bad ring-bad/25",
  brand: "bg-brand-50 text-brand ring-brand/25",
  accent: "bg-accent-50 text-accent ring-accent/25",
}
const dots: Record<Tone, string> = {
  neutral: "bg-muted",
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  brand: "bg-brand",
  accent: "bg-accent",
}

export function Badge({ tone = "neutral", children, dot, pulse }: { tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset", tones[tone])}>
      {dot && <span className={cx("size-1.5 rounded-full", dots[tone], pulse && "animate-pulse-ring")} aria-hidden />}
      {children}
    </span>
  )
}

const alertIcon: Record<Tone, Icon> = {
  neutral: Info,
  brand: Info,
  accent: Info,
  ok: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
}
export function Alert({ tone = "neutral", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  const I = alertIcon[tone]
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cx("flex gap-3 rounded-xl px-4 py-3 text-sm ring-1 ring-inset", tones[tone])}
    >
      <I className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && "opacity-90")}>{children}</div>}
      </div>
    </div>
  )
}

export const PHASE_LABEL: Record<Phase, string> = {
  pending: "Opens soon",
  registration: "Registration open",
  awaiting_vote: "Roll frozen soon",
  voting: "Voting open",
  closed: "Closed",
}
const PHASE_TONE: Record<Phase, Tone> = { pending: "neutral", registration: "brand", awaiting_vote: "warn", voting: "ok", closed: "neutral" }

export function PhaseBadge({ phase }: { phase: Phase | null }) {
  if (!phase) return <Badge>Not published</Badge>
  return (
    <Badge tone={PHASE_TONE[phase]} dot pulse={phase === "voting"}>
      {PHASE_LABEL[phase]}
    </Badge>
  )
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-6 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
      {label}…
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-xl bg-subtle", className)} aria-hidden />
}

export function PageLoader() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-9 w-2/3" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

export function EmptyState({ icon: I, title, children, action }: { icon: Icon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand">
        <I className="size-6" aria-hidden />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ data display
export function Stat({
  label,
  value,
  sub,
  icon: I,
  tone = "brand",
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: Icon
  tone?: Tone
}) {
  return (
    <div className="rounded-2xl border border-line border-l-[3px] border-l-brand bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        {I && (
          <span className={cx("grid size-9 place-items-center rounded-xl ring-1 ring-inset", tones[tone])}>
            <I className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="font-display mt-2 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  )
}

export function ProgressBar({ value, tone = "brand", label }: { value: number; tone?: "brand" | "ok" | "accent"; label?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  const fill = { brand: "bg-brand", ok: "bg-ok", accent: "bg-accent" }[tone]
  return (
    <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-[width] duration-700", fill)} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex w-full items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "now" : "next"
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2" aria-current={state === "now" ? "step" : undefined}>
            <span
              className={cx(
                "grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ring-1 ring-inset transition",
                state === "done" && "bg-brand text-brand-ink ring-brand",
                state === "now" && "bg-brand-50 text-brand ring-brand shadow-[var(--shadow-glow)]",
                state === "next" && "bg-surface text-muted ring-line-strong",
              )}
            >
              {state === "done" ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={cx("hidden truncate text-sm font-medium sm:block", state === "next" ? "text-muted" : "text-ink")}>{s}</span>
            {i < steps.length - 1 && <span className={cx("h-px flex-1", i < current ? "bg-brand" : "bg-line-strong")} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

const AVATAR_COLORS = [
  "bg-[#e0e7ff] text-[#3730a3]",
  "bg-[#dcfce7] text-[#166534]",
  "bg-[#fef3c7] text-[#92400e]",
  "bg-[#fce7f3] text-[#9d174d]",
  "bg-[#e0f2fe] text-[#075985]",
  "bg-[#ede9fe] text-[#5b21b6]",
  "bg-[#ccfbf1] text-[#115e59]",
]
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")
  const h = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const s = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-12 text-base" }[size]
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full font-bold", s, AVATAR_COLORS[h % AVATAR_COLORS.length])} aria-hidden>
      {initials || "?"}
    </span>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("mono", className)}>{children}</span>
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(value).catch(() => null)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className="inline-grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-subtle hover:text-brand"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
    >
      {done ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  )
}

export function HashChip({ value, n = 10, full }: { value: string | null | undefined; n?: number; full?: boolean }) {
  if (!value) return <span className="text-muted">—</span>
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-lg bg-subtle py-0.5 pl-2 pr-0.5">
      <Mono className="truncate">{full ? value : short(value, n)}</Mono>
      <CopyButton value={value} />
    </span>
  )
}

export function Countdown({ to, label }: { to: string; label: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ms = new Date(to).getTime() - now
  if (ms <= 0) return null
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms / 3_600_000) % 24)
  const m = Math.floor((ms / 60_000) % 60)
  const s = Math.floor((ms / 1000) % 60)
  const parts = [
    ["days", d],
    ["hrs", h],
    ["min", m],
    ["sec", s],
  ] as const
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-2 flex gap-2">
        {parts.map(([u, v]) => (
          <div key={u} className="min-w-14 rounded-xl border border-line bg-surface px-2 py-1.5 text-center shadow-sm">
            <p className="text-xl font-bold tabular-nums">{String(v).padStart(2, "0")}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{u}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export const fmtDate = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
export const fmtDay = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" })
export const short = (s: string | null | undefined, n = 10) => (!s ? "—" : s.length <= n * 2 ? s : `${s.slice(0, n)}…${s.slice(-6)}`)
