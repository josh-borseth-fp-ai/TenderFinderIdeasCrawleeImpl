import { describe, it, expect } from "vitest"
import { emptyBrief } from "../../domain/Source.ts"
import { validateBrief, validateRecords, permittedUrl } from "./Records.ts"

const brief = emptyBrief("City", "https://example.com/bids")
const record = { title: "Bridge repair", sourceUrl: "https://example.com/bids/1", evidence: "Bridge repair · City", status: "open" }
const options = { testsPassed: true, visitedCount: 2, coverage: "All pages", now: new Date("2026-09-16T12:00:00Z") }
describe("bid validation", () => {
  it("normalizes missing values and removes tracking-query duplicates", () => {
    const result = validateRecords([record, { ...record, sourceUrl: `${record.sourceUrl}?utm_source=mail` }], "city", brief, options)
    expect(result.report.passed).toBe(true)
    expect(result.report.duplicateCount).toBe(1)
    expect(result.records[0]).toMatchObject({ buyer: null, budget: null, currency: null, attachmentLinks: [], deadline: null })
    expect(result.report.warnings).toHaveLength(2)
  })
  it("filters closed, expired, and excluded bids without inventing timezone information", () => {
    const result = validateRecords([
      record, { ...record, sourceUrl: `${record.sourceUrl}2`, status: "closed" },
      { ...record, sourceUrl: `${record.sourceUrl}3`, deadline: "2025-01-01T12:00:00Z" },
      { ...record, sourceUrl: `${record.sourceUrl}4`, deadlineRaw: "January 1", status: "unknown" },
      { ...record, sourceUrl: `${record.sourceUrl}5`, title: "Awarded highway" },
    ], "city", { ...brief, excludePatterns: ["awarded*"] }, options)
    expect(result.report.excludedCount).toBe(3)
    expect(result.records).toHaveLength(2)
    expect(result.report.warnings).toContain("Some records have unknown status; confirm that they are open.")
  })
  it("rejects absent required fields, invalid currencies, missing evidence and empty samples", () => {
    expect(validateRecords([record], "city", { ...brief, requiredFields: ["buyer"] }, options).report.passed).toBe(false)
    expect(validateRecords([{ ...record, currency: "$" }], "city", brief, options).report.passed).toBe(false)
    expect(validateRecords([{ ...record, evidence: "" }], "city", brief, options).report.passed).toBe(false)
    expect(validateRecords([], "city", brief, options).report.passed).toBe(false)
  })
  it("validates domain scope and refuses unsafe URLs and unknown field names", () => {
    expect(() => permittedUrl("https://other.example/bid", brief)).toThrow("Outside source")
    expect(() => validateBrief({ ...brief, allowedDomains: ["127.0.0.1"], seedUrls: ["http://127.0.0.1"] })).toThrow()
    expect(() => validateBrief({ ...brief, requiredFields: ["nonexistent"] })).toThrow("Unknown bid field")
    expect(() => validateBrief({ ...brief, allowedDomains: ["example.com/path"] })).toThrow()
  })
})
