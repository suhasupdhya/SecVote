// Visual check helper: node e2e/shots.mjs [baseUrl]  ->  .e2e/shots/pub-*.png (public pages, light + dark + mobile)
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const base = process.argv[2] ?? "http://localhost:3000"
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".e2e", "shots")
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()

async function shoot(name, path, { width = 1280, height = 900, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  if (dark) await ctx.addInitScript(() => localStorage.setItem("secvote:theme", "dark"))
  const page = await ctx.newPage()
  await page.goto(base + path, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(out, `pub-${name}.png`), fullPage: true })
  await ctx.close()
}

await shoot("home", "/")
await shoot("home-dark", "/", { dark: true })
await shoot("home-mobile", "/", { width: 390, height: 844 })
await shoot("elections", "/elections")
await shoot("elections-results", "/elections")
await shoot("login", "/login")
await shoot("signup", "/signup")
await shoot("login-mobile", "/login", { width: 390, height: 844 })
await browser.close()
console.log("shots written to", out)
