// Accounts: forgot-password reset, sign-up keeps the page you came from, and a visual record of the public pages.
import { expect, test } from "@playwright/test"
import { latestCode, shot, signUp, stack } from "./helpers"

test("forgot password, sign-up return path and public pages", async ({ browser }) => {
  const s = await stack()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // ---------------------------------------------------------------- public pages (visitor)
  for (const [path, name] of [
    ["/", "pub-home"],
    ["/elections", "pub-elections"],
    ["/help", "pub-help"],
    ["/login", "pub-login"],
    ["/signup", "pub-signup"],
    ["/forgot", "pub-forgot"],
  ] as const) {
    await page.goto(path)
    await shot(page, name)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await shot(page, "pub-home-mobile")
  await page.setViewportSize({ width: 1280, height: 900 })

  // ---------------------------------------------------------------- forgot password
  const email = `reset${Date.now()}@example.edu.in`
  await signUp(page, s, "Reset Voter", email)
  const other = await (await browser.newContext()).newPage()
  await other.goto("/login")
  await other.getByRole("link", { name: "Forgot password?" }).click()
  await other.waitForURL((u) => u.pathname === "/forgot")
  await expect(other.getByRole("heading", { name: "Forgot your password?" })).toBeVisible()
  await other.getByLabel("Email").fill(email)
  await other.getByRole("button", { name: "Email me a code" }).click()
  await expect(other.getByLabel("Code from email")).toBeVisible()
  await other.getByLabel("Code from email").fill(latestCode(s, email))
  await other.getByLabel("New password", { exact: true }).fill("a-brand-new-passphrase")
  await other.getByLabel("Repeat new password").fill("a-brand-new-passphrase")
  await shot(other, "pub-forgot-reset")
  await other.getByRole("button", { name: "Reset password" }).click()
  await other.waitForURL((u) => u.pathname === "/login")
  await expect(other.getByText("Your password has been changed")).toBeVisible()
  await other.getByLabel("Email").fill(email)
  await other.getByLabel("Password").fill("a-brand-new-passphrase")
  await other.getByRole("button", { name: "Sign in" }).click()
  await other.waitForURL((u) => u.pathname === "/dashboard")

  // change it again from My account; this device stays signed in
  await other.goto("/me")
  await other.getByRole("button", { name: "Change password" }).click()
  await other.getByLabel("Current password").fill("a-brand-new-passphrase")
  await other.getByLabel("New password", { exact: true }).fill("yet-another-passphrase")
  await other.getByLabel("Repeat new password").fill("yet-another-passphrase")
  await other.getByRole("button", { name: "Change password" }).click()
  await expect(other.getByText("Password changed.")).toBeVisible()
  await shot(other, "pub-me-password")
  await other.reload()
  await expect(other.getByRole("heading", { name: "Account & registrations" })).toBeVisible()

  // the session that existed before the reset is signed out
  await page.goto("/dashboard")
  await page.waitForURL((u) => u.pathname === "/login")

  // ---------------------------------------------------------------- sign-up returns you to where you were going
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto("/login?next=/help")
  await visitor.getByRole("link", { name: "Create an account" }).click()
  await expect(visitor).toHaveURL(/\/signup\?next=%2Fhelp/)
  const email2 = `return${Date.now()}@example.edu.in`
  await visitor.getByLabel("Full name").fill("Return Voter")
  await visitor.getByLabel("Institution email").fill(email2)
  await visitor.getByLabel("Password").fill("password-123456")
  await visitor.getByRole("button", { name: "Create account" }).click()
  await expect(visitor.getByLabel("Verification code")).toBeVisible()
  await visitor.getByLabel("Verification code").fill(latestCode(s, email2))
  await visitor.getByRole("button", { name: "Verify and continue" }).click()
  await visitor.waitForURL((u) => u.pathname === "/help")
})
