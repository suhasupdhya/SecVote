import { expect, type Page } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type Stack = { rpc: string; api: string; web: string; mailbox: string; admin: { email: string; password: string } }
export const STACK_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".e2e", "stack.json")

export async function stack(): Promise<Stack> {
  for (let i = 0; i < 120 && !existsSync(STACK_FILE); i++) await new Promise((r) => setTimeout(r, 500))
  return JSON.parse(readFileSync(STACK_FILE, "utf8")) as Stack
}

/** Latest 6-digit code emailed to this address (dev console mailbox). */
export function latestCode(s: Stack, email: string): string {
  const lines = readFileSync(s.mailbox, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; body: string })
  const body = lines.reverse().find((m) => m.to === email)!.body
  return body.match(/\b(\d{6})\b/)![1]!
}

export async function shot(page: Page, name: string) {
  if (!process.env.SECVOTE_SHOTS) return
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(dirname(STACK_FILE), "shots", `${name}.png`), fullPage: true })
}

export async function apiElection(s: Stack, id: string) {
  return (await (await fetch(`${s.api}/api/v1/elections/${id}`)).json()) as { id: string; slug: string; phase: string }
}

export async function waitPhase(s: Stack, id: string, phase: string) {
  await expect.poll(async () => (await apiElection(s, id)).phase, { timeout: 60_000, intervals: [500] }).toBe(phase)
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL((u) => u.pathname !== "/login")
}

export async function signUp(page: Page, s: Stack, name: string, email: string) {
  await page.goto("/signup")
  await page.getByLabel("Full name").fill(name)
  await page.getByLabel("Institution email").fill(email)
  await page.getByLabel("Password").fill("password-123456")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByLabel("Verification code")).toBeVisible()
  await page.getByLabel("Verification code").fill(latestCode(s, email))
  await page.getByRole("button", { name: "Verify and continue" }).click()
  await page.waitForURL((u) => u.pathname === "/dashboard")
}
