"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"
import { X } from "lucide-react"
import { Button, type Icon } from "./ui"

/** Accessible modal built on <dialog>: focus trap, Esc to close, backdrop click to close. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  icon: I,
  children,
  confirmLabel,
  confirmVariant = "primary",
  busy,
  disabled,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  icon?: Icon
  children: ReactNode
  confirmLabel: string
  confirmVariant?: "primary" | "danger"
  busy?: boolean
  /** keeps the confirm button disabled, e.g. while the action would be refused */
  disabled?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby={titleId}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          {I && (
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand">
              <I className="size-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold tracking-tight">
              {title}
            </h2>
            <div className="mt-2 space-y-3 text-sm text-ink-2">{children}</div>
          </div>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} busy={busy} disabled={disabled} icon={I}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
