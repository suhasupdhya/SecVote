// Phase 4 gate through the real UI: sealed ballots, 2-of-3 trustees, ranked choice, verify page.
import { expect, test, type Page } from "@playwright/test"
import { apiElection, latestCode, shot, signIn, signUp, stack, waitPhase } from "./helpers"

const PASS = "correct horse battery staple"
const TRUSTEE_PASS = "trustee passphrase 123"

test("sealed election: trustees, ranked choice, verify", async ({ browser }) => {
  test.setTimeout(420_000)
  const s = await stack()
  const run = Date.now()
  const page = async () => (await browser.newContext()).newPage()
  const admin = await page()
  const trustees: Page[] = [await page(), await page(), await page()]
  const voter = await page()

  // ---------------------------------------------------------------- people sign up
  const trusteeEmails = trustees.map((_, i) => `trustee${i + 1}-${run}@example.edu.in`)
  for (const [i, t] of trustees.entries()) await signUp(t, s, `Trustee ${["Asha", "Bharat", "Chen"][i]}`, trusteeEmails[i]!)
  const voterEmail = `sealed-voter-${run}@example.edu.in`
  await signUp(voter, s, "Sealed Voter", voterEmail)

  // ---------------------------------------------------------------- admin: sealed election with a ranked race
  await signIn(admin, s.admin.email, s.admin.password, s)
  await admin.goto("/admin/elections/new")
  await admin.getByLabel("Title", { exact: true }).fill("Sealed Student Council")
  await admin.getByLabel("Organisation").fill("Example College")
  await admin.getByRole("radio", { name: /Sealed ballot/ }).check()
  await admin.getByLabel("Post title").first().fill("President")
  await admin.getByLabel("Candidates (one per line)").first().fill("Asha\nBala")
  await admin.getByRole("button", { name: "Add post" }).click()
  await admin.getByLabel("Post title").nth(1).fill("Secretary")
  await admin.getByLabel("Candidates (one per line)").nth(1).fill("Dev\nEsha\nFarah")
  await admin.getByLabel("Counting").nth(1).selectOption("irv")
  await admin.getByRole("button", { name: "Save draft" }).click()
  await admin.waitForURL(/\/admin\/elections\/[a-f0-9]{24}$/)
  const electionId = admin.url().split("/").pop()!
  await expect(admin.getByText("Set up the trustees and key ceremony")).toBeVisible()

  for (const email of trusteeEmails) {
    await admin.getByLabel("Add trustee by email").fill(email)
    await admin.getByRole("button", { name: "Add trustee" }).click()
    await expect(admin.getByText(email)).toBeVisible()
  }

  // ---------------------------------------------------------------- trustees: create personal keys in their browsers
  for (const t of trustees) {
    await t.goto("/trustee")
    await t.getByLabel("Trustee passphrase", { exact: true }).fill(TRUSTEE_PASS)
    await t.getByLabel("Repeat trustee passphrase").fill(TRUSTEE_PASS)
    await t.getByRole("button", { name: "Create trustee key" }).click()
    const dl = t.waitForEvent("download")
    await t.getByRole("button", { name: "Download trustee key backup" }).click()
    expect((await dl).suggestedFilename()).toContain("secvote-trustee-key")
    await t.getByRole("button", { name: "Register my trustee key" }).click()
    await expect(t.getByText("Waiting for the key ceremony")).toBeVisible()
  }
  await shot(trustees[0]!, "20-trustee-key")

  // ---------------------------------------------------------------- key ceremony in the admin's browser, then publish
  await admin.reload()
  await admin.getByRole("button", { name: "Run key ceremony" }).click()
  await expect(admin.getByText("Key ceremony complete")).toBeVisible({ timeout: 30_000 })
  await shot(admin, "21-ceremony-done")
  admin.once("dialog", (d) => void d.accept()) // "no voter list" warning: fine for this test
  await admin.getByRole("button", { name: "Publish on chain" }).click()
  await expect(admin.getByRole("link", { name: "Public page" })).toBeVisible({ timeout: 60_000 }) // shown once the contract is live
  const { slug } = await apiElection(s, electionId)

  // ---------------------------------------------------------------- voter registers and enrols
  await voter.goto(`/elections/${slug}/register`)
  await voter.getByLabel("Registration number").fill(`SV${run}`.slice(0, 20))
  await voter.getByLabel("Department").fill("Physics")
  await voter.getByLabel("Year of study").fill("2")
  await voter.getByLabel("ID card", { exact: true }).setInputFiles({ name: "id.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") })
  await voter.getByRole("checkbox").check()
  await voter.getByRole("button", { name: "Submit application" }).click()
  await admin.reload()
  await admin.getByRole("button", { name: "Approve Sealed Voter" }).click()
  await expect(voter.getByText("We emailed a 6-digit enrolment code")).toBeVisible({ timeout: 30_000 })
  await voter.getByLabel("Enrolment code from email").fill(latestCode(s, voterEmail))
  await voter.getByLabel("Passphrase", { exact: true }).fill(PASS)
  await voter.getByLabel("Repeat passphrase").fill(PASS)
  await voter.getByRole("button", { name: "Create identity" }).click()
  const backup = voter.waitForEvent("download")
  await voter.getByRole("button", { name: "Download backup card" }).click()
  await backup
  await voter.getByLabel("Type your passphrase once more").fill(PASS)
  await voter.getByRole("button", { name: "Check", exact: true }).click()
  await voter.getByRole("checkbox").check()
  await voter.getByRole("button", { name: "Add me to the roll" }).click()
  await expect(voter.getByText("On the on-chain roll")).toBeVisible({ timeout: 60_000 })

  // ---------------------------------------------------------------- open voting, cast an encrypted ranked ballot
  await admin.reload()
  await admin.getByRole("button", { name: "Start voting now" }).click()
  await admin.getByRole("dialog", { name: "Start voting now?" }).getByRole("button", { name: "Start voting now" }).click()
  await waitPhase(s, electionId, "voting")

  await voter.goto(`/elections/${slug}/vote`)
  await voter.getByLabel("Passphrase").fill(PASS)
  await voter.getByRole("button", { name: "Unlock" }).click()
  await expect(voter.getByText("Sealed ballot", { exact: true })).toBeVisible()
  await voter.getByRole("group", { name: "President" }).getByLabel("Bala").check()
  await voter.getByRole("button", { name: "Rank Esha" }).click()
  await voter.getByRole("button", { name: "Rank Dev" }).click()
  await shot(voter, "22-ranked-ballot")
  await voter.getByRole("button", { name: "Review ballot" }).click()
  await expect(voter.getByText("1. Esha")).toBeVisible()
  await voter.getByRole("button", { name: "Confirm and cast ballot" }).click()
  await expect(voter.getByText("Ballot submitted")).toBeVisible({ timeout: 120_000 })

  // ---------------------------------------------------------------- close: nothing countable yet
  await expect.poll(async () => ((await (await fetch(`${s.api}/api/v1/elections/${electionId}`)).json()) as { chain: { ballot_count: number } }).chain.ballot_count, { timeout: 60_000 }).toBe(1)
  await admin.reload()
  await admin.getByRole("button", { name: "End voting now" }).click()
  await admin.getByRole("dialog", { name: "End voting now?" }).getByRole("button", { name: "End voting now" }).click()
  await waitPhase(s, electionId, "closed")
  await admin.goto(`/elections/${slug}/bulletin`)
  await expect(admin.getByText(/two of the three trustees unlock/)).toBeVisible() // even officials can't count

  // ---------------------------------------------------------------- two trustees release their shares
  for (const t of trustees.slice(0, 2)) {
    await t.goto("/trustee")
    await t.getByLabel("Trustee passphrase").fill(TRUSTEE_PASS)
    await t.getByRole("button", { name: "Release my share" }).click()
    await expect(t.getByText(/Your share is released|Done: the key is public/)).toBeVisible({ timeout: 30_000 })
  }

  // ---------------------------------------------------------------- key revealed on chain -> counted -> declare
  await admin.goto(`/admin/elections/${electionId}`)
  await expect
    .poll(
      async () => {
        await admin.reload()
        await admin.getByText("Next step").waitFor()
        return admin.getByRole("button", { name: "Declare result" }).count()
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(1)
  await admin.getByRole("button", { name: "Declare result" }).click()
  await expect(admin.getByRole("link", { name: "View results" })).toBeVisible({ timeout: 30_000 })

  // ---------------------------------------------------------------- everyone can now see and verify
  await voter.goto(`/elections/${slug}/bulletin`)
  await expect(voter.getByText("Matches declared result")).toBeVisible({ timeout: 60_000 })
  await expect(voter.getByTestId("results-President").getByRole("listitem").filter({ hasText: "Bala" })).toContainText("Winner")
  await expect(voter.getByTestId("results-Secretary").getByRole("listitem").filter({ hasText: "Esha" })).toContainText("Winner")
  await shot(voter, "23-sealed-results")
  await voter.getByRole("link", { name: "Verify it yourself" }).click()
  await expect(voter.getByTestId("verify-verdict")).toHaveText(/Verified/, { timeout: 60_000 })
  await shot(voter, "24-verify")
})
