// MVP gate: register -> approve -> commitment -> freeze -> vote -> receipt -> bulletin -> declare -> verify.
import { expect, test, type Page } from "@playwright/test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

type Stack = { rpc: string; api: string; web: string; mailbox: string; admin: { email: string; password: string } }
const STACK_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".e2e", "stack.json")

async function stack(): Promise<Stack> {
  for (let i = 0; i < 120 && !existsSync(STACK_FILE); i++) await new Promise((r) => setTimeout(r, 500))
  return JSON.parse(readFileSync(STACK_FILE, "utf8")) as Stack
}

function otpFor(s: Stack, email: string): string {
  const lines = readFileSync(s.mailbox, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string; body: string })
  const body = lines.reverse().find((m) => m.to === email)!.body
  return body.match(/\b(\d{6})\b/)![1]!
}

/** Optional visual record: SECVOTE_SHOTS=1 pnpm e2e  ->  .e2e/shots/*.png */
async function shot(page: Page, name: string) {
  if (!process.env.SECVOTE_SHOTS) return
  await page.waitForTimeout(600) // let entrance animations settle
  await page.screenshot({ path: join(dirname(STACK_FILE), "shots", `${name}.png`), fullPage: true })
}

async function apiElection(s: Stack, id: string) {
  return (await (await fetch(`${s.api}/api/v1/elections/${id}`)).json()) as {
    id: string
    slug: string
    reg_end: string
    vote_start: string
    vote_end: string
    phase: string
  }
}

async function waitPhase(s: Stack, id: string, phase: string) {
  await expect.poll(async () => (await apiElection(s, id)).phase, { timeout: 60_000, intervals: [500] }).toBe(phase)
}

async function unlockAndVote(page: Page, slug: string, president: string, secretary: string) {
  await page.goto(`/elections/${slug}/vote`)
  await page.getByLabel("Passphrase").fill("correct horse battery staple")
  await page.getByRole("button", { name: "Unlock" }).click()
  await page.getByRole("group", { name: "President" }).getByLabel(president).check()
  await page.getByRole("group", { name: "Secretary" }).getByLabel(secretary).check()
  await shot(page, `11-ballot-${president}`)
  await page.getByRole("button", { name: "Review ballot" }).click()
  await page.getByRole("button", { name: "Confirm and cast ballot" }).click()
}

test("full open-mode election on Anvil", async ({ browser }) => {
  const s = await stack()
  const adminCtx = await browser.newContext()
  const voterCtx = await browser.newContext()
  const admin = await adminCtx.newPage()
  const voter = await voterCtx.newPage()

  // ---------------------------------------------------------------- admin creates + publishes
  await admin.goto("/login")
  await admin.getByLabel("Email").fill(s.admin.email)
  await admin.getByLabel("Password").fill(s.admin.password)
  await admin.getByRole("button", { name: "Sign in" }).click()
  await admin.waitForURL((u) => u.pathname === "/admin") // officials land on the admin console
  // officials see only their own area in the header
  const adminNav = admin.getByRole("navigation", { name: "Main" })
  await expect(adminNav.getByRole("link", { name: "Admin console" })).toBeVisible()
  await expect(adminNav.getByRole("link", { name: "Dashboard" })).toHaveCount(0)
  await expect(adminNav.getByRole("link", { name: "Elections" })).toHaveCount(0)
  await admin.getByRole("link", { name: "New election" }).first().click()
  await admin.waitForURL((u) => u.pathname === "/admin/elections/new")
  await admin.getByLabel("Title", { exact: true }).fill("Student Council 2026")
  await admin.getByLabel("Organisation").fill("Example Colege")
  await admin.getByLabel("Post title").first().fill("President")
  await admin.getByLabel("Candidates (one per line)").first().fill("Asha\nBala\nChitra")
  await admin.getByRole("button", { name: "Add post" }).click()
  await admin.getByLabel("Post title").nth(1).fill("Secretary")
  await admin.getByLabel("Candidates (one per line)").nth(1).fill("Dev\nEsha")
  await admin.getByRole("button", { name: "Save draft" }).click()
  await admin.waitForURL(/\/admin\/elections\/[a-f0-9]{24}$/)
  await shot(admin, "03-admin-console-draft")
  const electionId = admin.url().split("/").pop()!
  // a typo in a draft is fixed by editing it, not by deleting and starting again
  await admin.getByRole("link", { name: "Edit draft" }).click()
  await expect(admin.getByLabel("Candidates (one per line)").nth(1)).toHaveValue("Dev\nEsha")
  await admin.getByLabel("Organisation").fill("Example College")
  await admin.getByRole("button", { name: "Add manifesto" }).first().click()
  await admin.getByLabel("Manifesto for Asha").fill("Longer library hours and a cleaner canteen.")
  await admin.getByRole("button", { name: "Save changes" }).click()
  await admin.waitForURL(/\/admin\/elections\/[a-f0-9]{24}$/)
  await expect(admin.getByText("Example College", { exact: true })).toBeVisible()
  await admin.getByRole("button", { name: "Publish on chain" }).click()
  await expect(admin.getByRole("link", { name: "Public page" })).toBeVisible({ timeout: 60_000 }) // shown once the contract is live
  const { slug } = await apiElection(s, electionId)
  await shot(admin, "04-admin-console-published")

  // ---------------------------------------------------------------- voter signs up + applies
  const email = `voter${Date.now()}@example.edu.in`
  await voter.goto("/signup")
  await voter.getByLabel("Full name").fill("Test Voter")
  await voter.getByLabel("Institution email").fill(email)
  await voter.getByLabel("Password").fill("voter-password-123")
  await voter.getByRole("button", { name: "Create account" }).click()
  await expect(voter.getByLabel("Verification code")).toBeVisible()
  await voter.getByLabel("Verification code").fill(otpFor(s, email))
  await voter.getByRole("button", { name: "Verify and continue" }).click()
  await voter.waitForURL((u) => u.pathname === "/dashboard") // voters land on their dashboard
  await expect(voter.getByRole("heading", { name: /Test/ })).toBeVisible()

  await voter.goto(`/elections/${slug}/register`)
  await voter.getByLabel("Registration number").fill("21CS042")
  await voter.getByLabel("Department").fill("Computer Science")
  await voter.getByLabel("Year of study").fill("3")
  await voter.getByLabel("ID card", { exact: true }).setInputFiles({ name: "id.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") })
  await voter.getByRole("checkbox").check()
  await voter.getByRole("button", { name: "Submit application" }).click()
  await expect(voter.getByText("Your application is with the election officials")).toBeVisible()
  await shot(voter, "06-register-pending")
  await admin.reload()
  await shot(admin, "07-admin-review-queue")

  // ---------------------------------------------------------------- admin rejects once; voter re-applies (last attempt)
  await admin.reload()
  admin.once("dialog", (d) => d.accept("ID card is blurry"))
  await admin.getByRole("button", { name: "Reject" }).click()
  await expect(admin.getByRole("button", { name: "Approve Test Voter" })).toHaveCount(0)
  await expect(voter.getByText("Reason: ID card is blurry")).toBeVisible({ timeout: 15_000 })
  await expect(voter.getByText("This is your last attempt")).toBeVisible()
  await expect(voter.getByLabel("Registration number")).toHaveValue(/21CS/)
  await voter.getByLabel("ID card", { exact: true }).setInputFiles({ name: "id.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") })
  await voter.getByRole("checkbox").check()
  await shot(voter, "06b-register-reapply")
  await voter.getByRole("button", { name: "Submit again" }).click()
  await expect(voter.getByText("Your application is with the election officials")).toBeVisible()

  // ---------------------------------------------------------------- admin approves the re-application
  await admin.reload()
  await expect(admin.getByText("Rejected before: ID card is blurry")).toBeVisible()
  await shot(admin, "07b-admin-review-reapplied")
  await admin.getByRole("button", { name: "Approve Test Voter" }).click()
  await expect(admin.getByRole("button", { name: "Approve Test Voter" })).toHaveCount(0)

  // ---------------------------------------------------------------- voter creates identity in the browser
  await expect(voter.getByText("create your voting identity")).toBeVisible({ timeout: 30_000 })
  await expect(voter.getByText("We emailed a 6-digit enrolment code")).toBeVisible()
  await voter.getByLabel("Enrolment code from email").fill(otpFor(s, email)) // latest email = enrolment code
  await voter.getByLabel("Passphrase", { exact: true }).fill("correct horse battery staple")
  await voter.getByLabel("Repeat passphrase").fill("correct horse battery staple")
  await shot(voter, "08-identity-setup")

  // the office uploads its voter list (pasted, first CSV column, header skipped, duplicates merged)
  await admin.getByLabel("Registration numbers").fill("Reg No,Name\n21CS042,Test Voter\n21cs043,Other\n21CS043,Other")
  await expect(admin.getByText("2 registration numbers found")).toBeVisible()
  await admin.getByRole("button", { name: "Save list" }).click()
  await expect(admin.getByText("Saved 2 registration numbers.")).toBeVisible()
  await shot(admin, "07c-admin-voter-list")
  await voter.getByRole("button", { name: "Create identity" }).click()
  const download = voter.waitForEvent("download")
  await voter.getByRole("button", { name: "Download backup card" }).click()
  const card = await download
  expect(card.suggestedFilename()).toBe(`secvote-identity-${slug}.png`)
  const cardPath = join(dirname(STACK_FILE), "identity-card.png")
  await card.saveAs(cardPath)
  if (process.env.SECVOTE_SHOTS) await card.saveAs(join(dirname(STACK_FILE), "shots", "08b-backup-card.png"))
  await voter.getByRole("checkbox").check()
  await voter.getByRole("button", { name: "Add me to the roll" }).click()
  await expect(voter.getByText("On the on-chain roll")).toBeVisible({ timeout: 60_000 })
  await shot(voter, "09-on-roll")

  // ---------------------------------------------------------------- officer opens voting early (no waiting)
  await admin.reload()
  await admin.getByRole("button", { name: "Start voting now" }).click()
  const dialog = admin.getByRole("dialog", { name: "Start voting now?" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Registration closes now")
  await shot(admin, "05-start-voting-dialog")
  await dialog.getByRole("button", { name: "Start voting now" }).click()
  await expect(dialog).toBeHidden()
  await waitPhase(s, electionId, "voting")
  await voter.goto(`/elections/${slug}`)
  await voter.getByText("Read manifesto").click()
  await expect(voter.getByText("Longer library hours and a cleaner canteen.")).toBeVisible()
  await shot(voter, "10-election-voting")

  // a new device with nothing stored: the backup card image restores the identity
  const otherDevice = await (await browser.newContext()).newPage()
  await otherDevice.goto(`/elections/${slug}/vote`)
  await otherDevice.getByLabel("Backup card").setInputFiles(cardPath)
  await otherDevice.getByLabel("Passphrase").fill("correct horse battery staple")
  await otherDevice.getByRole("button", { name: "Unlock" }).click()
  await expect(otherDevice.getByRole("group", { name: "President" })).toBeVisible()
  await otherDevice.close()
  // signed-in voters skip the landing page and go to their dashboard
  await voter.goto("/")
  await voter.waitForURL((u) => u.pathname === "/dashboard")
  await expect(voter.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin console" })).toHaveCount(0)
  await shot(voter, "01-voter-home")
  // an official can't use voter-only screens
  await admin.goto("/dashboard")
  await admin.waitForURL((u) => u.pathname === "/admin")
  await admin.goto(`/admin/elections/${electionId}`)

  // ---------------------------------------------------------------- vote anonymously
  await unlockAndVote(voter, slug, "Bala", "None of the above (NOTA)")
  await expect(voter.getByText("Ballot submitted")).toBeVisible({ timeout: 120_000 })
  await shot(voter, "12-receipt")
  await voter.getByRole("link", { name: "Track my ballot" }).click()
  await expect(voter.getByText("On the bulletin board")).toBeVisible({ timeout: 60_000 })
  await shot(voter, "13-tracker")

  // ---------------------------------------------------------------- double vote is refused
  await unlockAndVote(voter, slug, "Asha", "Dev")
  await expect(voter.getByText("You have already voted in this election")).toBeVisible({ timeout: 120_000 })
  await expect(voter.getByRole("button", { name: "Send again" })).toHaveCount(0)

  // ---------------------------------------------------------------- close, declare, verify
  // officer ends voting early, then declares
  await admin.reload()
  await admin.getByRole("button", { name: "End voting now" }).click()
  const endDialog = admin.getByRole("dialog", { name: "End voting now?" })
  await expect(endDialog).toContainText("ballot")
  await shot(admin, "15-end-voting-dialog")
  await endDialog.getByRole("button", { name: "End voting now" }).click()
  await waitPhase(s, electionId, "closed")

  // results stay hidden from voters until the officer publishes them; officials get a private preview
  await voter.goto(`/elections/${slug}/bulletin`)
  await expect(voter.getByText("Voting has closed: results coming soon")).toBeVisible()
  await expect(voter.getByText("Results aren't published yet")).toBeVisible()
  await expect(voter.getByTestId("results-President")).toHaveCount(0)
  await shot(voter, "14a-results-hidden")
  await admin.goto(`/elections/${slug}/bulletin`)
  await expect(admin.getByText("Private preview: not published yet")).toBeVisible()
  await expect(admin.getByTestId("results-President")).toBeVisible()

  await admin.goto(`/admin/elections/${electionId}`)
  await admin.getByRole("button", { name: "Declare result" }).click()
  await expect(admin.getByRole("link", { name: "View results" })).toBeVisible({ timeout: 30_000 })
  await voter.goto(`/elections/${slug}/bulletin`)
  await expect(voter.getByText("Matches declared result")).toBeVisible({ timeout: 60_000 })
  await shot(voter, "14-bulletin-results")
  const csv = voter.waitForEvent("download")
  await voter.getByRole("button", { name: "Download CSV" }).click()
  expect((await csv).suggestedFilename()).toBe(`${slug}-results.csv`)
  const president = voter.getByTestId("results-President")
  await expect(president.getByRole("listitem").filter({ hasText: "Bala" })).toContainText("1")
  await expect(voter.getByRole("cell", { name: "0", exact: true })).toBeVisible()

  // voter dashboard shows the saved receipt; sign-out really signs out
  await voter.goto("/dashboard")
  await expect(voter.getByText("My ballot receipts")).toBeVisible()
  await expect(voter.getByRole("link", { name: "Track" })).toHaveCount(1)
  await shot(voter, "17-voter-dashboard")
  await voter.getByRole("button", { name: "Sign out" }).click()
  await voter.waitForURL((u) => u.pathname === "/login")
  await expect(voter.getByRole("link", { name: "Register", exact: true })).toBeVisible()
  await voter.goto("/")
  await expect(voter.getByRole("heading", { name: /Every vote secret/ })).toBeVisible() // visitors get the landing page
  await voter.goto("/dashboard")
  await voter.waitForURL((u) => u.pathname === "/login")

  // extra visual record (no-op unless SECVOTE_SHOTS=1)
  await admin.reload()
  await shot(admin, "16-admin-console-closed")
  await admin.goto("/admin")
  await shot(admin, "02-admin-dashboard")
  await admin.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Officials" }).click()
  await expect(admin.getByRole("heading", { name: "Officials and roles" })).toBeVisible()
  await expect(admin.getByRole("group", { name: "Roles for Test Voter" })).toBeVisible()
  await shot(admin, "02b-admin-officials")
  await admin.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Audit log" }).click()
  await expect(admin.getByText("Integrity check passed")).toBeVisible()
  await expect(admin.getByText("Result declared")).toBeVisible()
  await shot(admin, "02c-admin-audit")
})
