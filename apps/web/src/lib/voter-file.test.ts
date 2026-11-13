import { describe, expect, it } from "vitest"
import { parseRegister } from "./voter-file"

describe("parseRegister", () => {
  it("finds columns by header name, in any order", () => {
    const rows = parseRegister('Name,Year,Roll No,Dept,E-mail\n"Kumar, Ravi",3rd,21cs001,CSE,Ravi@College.edu\n')
    expect(rows).toEqual([{ reg_no: "21CS001", email: "ravi@college.edu", name: "Kumar, Ravi", department: "CSE", year: 3 }])
  })

  it("uses the default order without a header, and reads roman years", () => {
    expect(parseRegister("21EC601,two@x.edu,Two,ECE,III")).toEqual([
      { reg_no: "21EC601", email: "two@x.edu", name: "Two", department: "ECE", year: 3 },
    ])
  })

  it("reads rows copied from Excel (tab-separated), keeping commas inside names", () => {
    expect(parseRegister("Roll No\tName\tEmail\n21CS001\tKumar, Ravi\travi@x.edu")).toEqual([
      { reg_no: "21CS001", name: "Kumar, Ravi", email: "ravi@x.edu" },
    ])
  })

  it("keeps one row per registration number and skips blanks", () => {
    const rows = parseRegister("21CS001,a@x.edu\n\n21cs001,b@x.edu\n ,c@x.edu")
    expect(rows).toHaveLength(1)
    expect(rows[0]!.email).toBe("b@x.edu")
  })
})
