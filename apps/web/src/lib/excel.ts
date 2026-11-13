// Excel (.xlsx) import/export for voter lists. The libraries load only when an admin actually uses them.
import type { SheetData } from "write-excel-file/browser"

type Cell = string | number | boolean | Date | null | undefined

function cellText(v: Cell): string {
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  // Registration numbers typed as numbers come back as 21001, not "21001.0"
  return String(v)
}

/** The first sheet of an .xlsx file as rows of text. */
export async function readExcelRows(file: File): Promise<string[][]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel file (.xlsx). Older .xls files: open them in Excel and save as .xlsx.")
  const { readSheet } = await import("read-excel-file/universal")
  let rows: Cell[][]
  try {
    rows = (await readSheet(file)) as Cell[][]
  } catch {
    throw new Error("That file couldn't be read as an Excel sheet. Save it as .xlsx and try again.")
  }
  return rows.map((r) => r.map(cellText)).filter((r) => r.some((c) => c.trim()))
}

/** Rows as tab-separated text, the same shape as cells copied out of Excel, for the paste box. */
export function rowsToText(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ").trim()).join("\t")).join("\n")
}

/** Download an .xlsx file built from rows (e.g. a template with a header and an example row). */
export async function downloadExcel(rows: (string | number)[][], fileName: string): Promise<void> {
  const { default: writeExcelFile } = await import("write-excel-file/browser")
  const header = rows[0] ?? []
  const data: SheetData = [header.map((h) => ({ value: h, fontWeight: "bold" })), ...rows.slice(1)]
  await writeExcelFile(data, { columns: header.map(() => ({ width: 24 })) }).toFile(fileName)
}
