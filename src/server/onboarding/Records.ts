import { createHash } from "node:crypto"
import { Schema } from "effect"
import { BidRecord, type SourceBrief, type ValidationReport } from "../../domain/Source.ts"
import { publicUrl } from "../ScrapeHttpClient.ts"

export const matchesPattern = (value: string, pattern: string) => {
  // Deliberately use glob-like text, never user-supplied regular expressions.
  const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
  return new RegExp(expression, "i").test(value)
}
export function permittedUrl(input: string, brief: SourceBrief, detail = false): string {
  const url = publicUrl(input)
  if (!brief.allowedDomains.includes(url.hostname.toLowerCase())) throw new Error(`Outside source domains: ${url.hostname}`)
  if (brief.excludePatterns.some((pattern) => matchesPattern(url.href, pattern))) throw new Error(`Excluded URL: ${url.href}`)
  if (detail && brief.includePatterns.length && !brief.includePatterns.some((pattern) => matchesPattern(url.href, pattern))) throw new Error(`URL does not match inclusion rules: ${url.href}`)
  return url.href
}
export function validateBrief(brief: SourceBrief): SourceBrief {
  if (!brief.name.trim() || brief.name.length > 200) throw new Error("Provide a source name (up to 200 characters).")
  if (!brief.seedUrls.length || brief.seedUrls.length > 20) throw new Error("Provide between one and 20 seed URLs.")
  if (brief.guidance.length > 20_000 || brief.allowedDomains.length > 30) throw new Error("Source guidance or domains exceed limits.")
  const domains = [...new Set(brief.allowedDomains.map((domain) => domain.trim().toLowerCase()))]
  for (const domain of domains) if (publicUrl(`https://${domain}`).hostname !== domain) throw new Error("Allowed domains must be exact hostnames, without paths or wildcards.")
  const fields = new Set(Object.keys(BidRecord.fields))
  for (const field of brief.requiredFields) if (!fields.has(field)) throw new Error(`Unknown bid field: ${field}`)
  for (const pattern of [...brief.includePatterns, ...brief.excludePatterns]) if (!pattern.trim() || pattern.length > 500) throw new Error("Patterns must contain 1–500 characters.")
  const normalized = { ...brief, name: brief.name.trim(), allowedDomains: domains, requiredFields: [...new Set(["title", "sourceUrl", ...brief.requiredFields])] }
  for (const url of brief.seedUrls) permittedUrl(url, normalized)
  return normalized
}

const nullable = ["buyer", "solicitationId", "description", "postedDate", "deadline", "deadlineRaw", "location", "currency", "budgetRaw", "contactDetails", "eligibility", "submissionInstructions"] as const
export function validateRecords(raw: unknown[], sourceId: string, brief: SourceBrief, options: { testsPassed: boolean; visitedCount: number; errors?: string[]; coverage: string; now?: Date; requireNonempty?: boolean }) {
  const records: BidRecord[] = [], errors = [...(options.errors ?? [])], warnings = new Set<string>(), seen = new Set<string>()
  let excludedCount = 0, duplicateCount = 0
  const now = options.now ?? new Date()
  for (const [index, value] of raw.entries()) {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a bid object")
      const input = value as Record<string, unknown>
      const url = permittedUrl(String(input.sourceUrl ?? ""), brief, true)
      const canonical = new URL(url); canonical.hash = ""
      for (const key of [...canonical.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) canonical.searchParams.delete(key)
      const normalized: Record<string, unknown> = {
        ...Object.fromEntries(nullable.map((key) => [key, input[key] ?? null])),
        sourceId, sourceUrl: canonical.href, extractedAt: now.toISOString(), title: input.title,
        status: input.status ?? "unknown", categories: input.categories ?? [], attachmentLinks: input.attachmentLinks ?? [],
        budget: input.budget ?? null, evidence: input.evidence ?? "",
      }
      normalized.id = createHash("sha256").update(`${sourceId}:${input.solicitationId || canonical.href}`).digest("hex").slice(0, 24)
      const record = Schema.decodeUnknownSync(BidRecord)(normalized)
      if (!record.title.trim() || record.title.length > 2000 || !record.evidence.trim()) throw new Error("Title and source evidence are required")
      for (const field of brief.requiredFields) {
        const fieldValue = normalized[field]
        if (fieldValue == null || fieldValue === "" || (Array.isArray(fieldValue) && fieldValue.length === 0)) throw new Error(`Missing required field: ${field}`)
      }
      for (const link of record.attachmentLinks) publicUrl(link)
      if (record.budget !== null && (!Number.isFinite(record.budget) || record.budget < 0)) throw new Error("Invalid budget")
      if (record.currency && !/^[A-Z]{3}$/.test(record.currency)) throw new Error("Currency must be an explicit three-letter code")
      for (const field of ["postedDate", "deadline"] as const) {
        const date = record[field]
        if (date && (!/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(date) || !Number.isFinite(Date.parse(date)))) throw new Error(`${field} must be an ISO date or timezone-qualified timestamp; preserve ambiguous text in raw fields`)
      }
      // Only timezone-qualified timestamps are safe for expiry. Date-only values remain reviewable.
      const deadline = record.deadline && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.deadline) ? Date.parse(record.deadline) : NaN
      const content = `${record.title}\n${record.description ?? ""}\n${record.buyer ?? ""}`
      if (brief.excludePatterns.some((pattern) => matchesPattern(content, pattern)) || (brief.openOnly && (["closed", "awarded", "cancelled"].includes(record.status) || (Number.isFinite(deadline) && deadline < now.getTime())))) { excludedCount++; continue }
      if (seen.has(record.id)) { duplicateCount++; continue }
      seen.add(record.id)
      if (record.status === "unknown") warnings.add("Some records have unknown status; confirm that they are open.")
      if (!Number.isFinite(deadline)) warnings.add("Some deadlines are missing or lack a timezone; expiry could not be determined.")
      if (!record.buyer) warnings.add("Some records have no buyer.")
      records.push(record)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith("Excluded URL") || message.startsWith("URL does not match inclusion")) excludedCount++
      else errors.push(`Record ${index + 1}: ${message.slice(0, 500)}`)
    }
  }
  if (!records.length && options.requireNonempty !== false) errors.push("No valid matching live records. A nonempty sample is required for approval.")
  if (!records.length && options.requireNonempty === false) warnings.add("This run produced no matching records.")
  const report: ValidationReport = {
    passed: options.testsPassed && errors.length === 0, testsPassed: options.testsPassed,
    errors, warnings: [...warnings], recordCount: records.length, excludedCount, duplicateCount,
    visitedCount: options.visitedCount, coverage: options.coverage, checkedAt: now.toISOString(),
  }
  return { records, report }
}
