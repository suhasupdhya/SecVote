// Reads a voter list (an Excel sheet, or rows pasted from Excel) into structured entries.
// With a header row, columns are found by name; without one, the order is:
//   registration number, email, name, department, year

export type RegisterRow = { reg_no: string; email?: string; name?: string; department?: string; year?: number }

const HEADERS: [keyof RegisterRow, RegExp][] = [
  ["reg_no", /^(reg(istration)?\.?\s*(no|number)?|roll\s*(no|number)?|register\s*(no|number)|enrol?l?ment\s*(no|number)?|student\s*id|id)$/i],
  ["email", /^(e-?mail|email\s*id|mail|official\s*e-?mail)$/i],
  ["name", /^(name|student\s*name|full\s*name)$/i],
  ["department", /^(dept\.?|department|branch|course|programme|program|class|section)$/i],
  ["year", /^(year|yr|year\s*of\s*study|semester\s*year)$/i],
]

/** Split one row. Rows copied from Excel are tab-separated (so "Kumar, Ravi" stays one cell); otherwise
 * commas or semicolons separate cells, honouring quotes. */
export function cells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim())
  const out: string[] = []
  let cur = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/** "3", "3rd", "III" -> 3 */
function parseYear(v: string): number | undefined {
  const roman: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 }
  const t = v.trim().toUpperCase()
  if (roman[t]) return roman[t]
  const n = Number.parseInt(t.replace(/[^0-9]/g, ""), 10)
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : undefined
}

export function parseRegister(text: string): RegisterRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  let order: (keyof RegisterRow | null)[] = ["reg_no", "email", "name", "department", "year"]
  const head = cells(lines[0]!)
  const mapped = head.map((h) => HEADERS.find(([, rx]) => rx.test(h))?.[0] ?? null)
  if (mapped.includes("reg_no")) {
    order = mapped
    lines.shift()
  }
  const out = new Map<string, RegisterRow>()
  for (const line of lines) {
    const row: RegisterRow = { reg_no: "" }
    cells(line).forEach((value, i) => {
      const key = order[i]
      if (!key || !value) return
      if (key === "year") row.year = parseYear(value)
      else if (key === "email") row.email = value.toLowerCase()
      else if (key === "reg_no") row.reg_no = value.replace(/\s+/g, " ").toUpperCase()
      else row[key] = value
    })
    // A stray email in the wrong column is still recognised.
    if (!row.email) {
      const at = cells(line).find((c) => c.includes("@"))
      if (at) row.email = at.toLowerCase()
    }
    if (row.reg_no) out.set(row.reg_no, row)
  }
  return [...out.values()]
}

export const REGISTER_TEMPLATE: (string | number)[][] = [
  ["Registration number", "Email", "Name", "Department", "Year"],
  ["21CS001", "asha@college.edu", "Asha R", "CSE", 3],
]
export const LIST_TEMPLATE: (string | number)[][] = [
  ["Registration number", "Email", "Name"],
  ["21CS001", "asha@college.edu", "Asha R"],
]
