"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

/** Light by default. The choice is remembered on this device; layout.tsx applies it before first paint. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false)
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.dataset.theme = next ? "dark" : "light"
    try {
      localStorage.setItem("secvote:theme", next ? "dark" : "light")
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white/85 transition hover:bg-white/10 hover:text-white ${className}`}
    >
      {dark ? <Sun className="size-3.5" aria-hidden /> : <Moon className="size-3.5" aria-hidden />}
      {dark ? "Light" : "Dark"}
    </button>
  )
}
