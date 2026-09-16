import { Schema } from "effect"

const NullableText = Schema.NullOr(Schema.String)
export const Strategy = Schema.Literals(["http", "cheerio", "playwright"])
export type Strategy = typeof Strategy.Type
export const BidRecord = Schema.Struct({
  id: Schema.String, sourceId: Schema.String, sourceUrl: Schema.String, extractedAt: Schema.String,
  title: Schema.String, buyer: NullableText, solicitationId: NullableText, description: NullableText,
  status: Schema.Literals(["open", "closed", "awarded", "cancelled", "unknown"]),
  postedDate: NullableText, deadline: NullableText, deadlineRaw: NullableText,
  location: NullableText, categories: Schema.Array(Schema.String), attachmentLinks: Schema.Array(Schema.String),
  budget: Schema.NullOr(Schema.Finite), currency: NullableText, budgetRaw: NullableText,
  contactDetails: NullableText, eligibility: NullableText, submissionInstructions: NullableText,
  evidence: Schema.String,
})
export type BidRecord = typeof BidRecord.Type
export const SourceBrief = Schema.Struct({
  name: Schema.String,
  seedUrls: Schema.Array(Schema.String),
  allowedDomains: Schema.Array(Schema.String),
  guidance: Schema.String,
  includePatterns: Schema.Array(Schema.String),
  excludePatterns: Schema.Array(Schema.String),
  requiredFields: Schema.Array(Schema.String),
  openOnly: Schema.Boolean,
})
export type SourceBrief = typeof SourceBrief.Type
export const RouteSpec = Schema.Struct({ label: Schema.String, strategy: Strategy, waitFor: Schema.NullOr(Schema.String) })
export const PackageDraft = Schema.Struct({
  rationale: Schema.String,
  runbook: Schema.String,
  code: Schema.String,
  tests: Schema.String,
  routes: Schema.Array(RouteSpec),
})
export type PackageDraft = typeof PackageDraft.Type
export const AgentDecision = Schema.Union([
  Schema.Struct({ action: Schema.Literal("inspect"), url: Schema.String, strategy: Strategy, reason: Schema.String }),
  Schema.Struct({ action: Schema.Literal("question"), message: Schema.String }),
  Schema.Struct({ action: Schema.Literal("generate"), package: PackageDraft }),
])
export type AgentDecision = typeof AgentDecision.Type

export const SourceMessage = Schema.Struct({ id: Schema.String, role: Schema.Literals(["user", "assistant"]), content: Schema.String, createdAt: Schema.String })
export type SourceMessage = typeof SourceMessage.Type
export const Source = Schema.Struct({ id: Schema.String, brief: SourceBrief, revision: Schema.Int, approvedVersionId: NullableText, createdAt: Schema.String, updatedAt: Schema.String })
export type Source = typeof Source.Type
export const Evidence = Schema.Struct({ url: Schema.String, finalUrl: Schema.String, strategy: Strategy, label: Schema.String, html: NullableText, dom: Schema.optional(Schema.String), json: Schema.Unknown, text: Schema.String, links: Schema.mutable(Schema.Array(Schema.String)) })
export type Evidence = typeof Evidence.Type
export const ValidationReport = Schema.Struct({
  passed: Schema.Boolean, testsPassed: Schema.Boolean, errors: Schema.mutable(Schema.Array(Schema.String)), warnings: Schema.mutable(Schema.Array(Schema.String)),
  recordCount: Schema.Int, excludedCount: Schema.Int, duplicateCount: Schema.Int, visitedCount: Schema.Int,
  coverage: Schema.String, checkedAt: Schema.String,
})
export type ValidationReport = typeof ValidationReport.Type
export const ScraperVersion = Schema.Struct({
  id: Schema.String, sourceId: Schema.String, revision: Schema.Int, digest: Schema.String, brief: SourceBrief,
  draft: PackageDraft, createdAt: Schema.String, report: Schema.NullOr(ValidationReport), samples: Schema.mutable(Schema.Array(BidRecord)),
  approvedAt: NullableText,
})
export type ScraperVersion = typeof ScraperVersion.Type
export const Job = Schema.Struct({
  id: Schema.String, sourceId: Schema.String, kind: Schema.Literals(["generate", "validate", "run"]), versionId: NullableText,
  revision: Schema.Int, state: Schema.Literals(["queued", "running", "succeeded", "failed", "cancelled", "interrupted", "needs-input"]),
  message: Schema.String, createdAt: Schema.String, updatedAt: Schema.String, report: Schema.NullOr(ValidationReport),
})
export type Job = typeof Job.Type
export type JobState = Job["state"]
export const ProgressEvent = Schema.Struct({ id: Schema.Int, jobId: Schema.String, sourceId: Schema.String, message: Schema.String, createdAt: Schema.String })
export type ProgressEvent = typeof ProgressEvent.Type
export const SourceDetail = Schema.Struct({ source: Source, messages: Schema.mutable(Schema.Array(SourceMessage)), versions: Schema.mutable(Schema.Array(ScraperVersion)), jobs: Schema.mutable(Schema.Array(Job)) })
export type SourceDetail = typeof SourceDetail.Type

export const SourceCommand = Schema.Union([
  Schema.Struct({ action: Schema.Literal("create"), brief: SourceBrief }),
  Schema.Struct({ action: Schema.Literal("update"), sourceId: Schema.String, revision: Schema.Int, brief: SourceBrief }),
  Schema.Struct({ action: Schema.Literal("message"), sourceId: Schema.String, content: Schema.String }),
  Schema.Struct({ action: Schema.Literal("generate"), sourceId: Schema.String }),
  Schema.Struct({ action: Schema.Literal("validate"), sourceId: Schema.String, versionId: Schema.String }),
  Schema.Struct({ action: Schema.Literal("approve"), sourceId: Schema.String, versionId: Schema.String, digest: Schema.String, revision: Schema.Int }),
  Schema.Struct({ action: Schema.Literal("run"), sourceId: Schema.String }),
  Schema.Struct({ action: Schema.Literal("cancel"), jobId: Schema.String }),
])
export type SourceCommand = typeof SourceCommand.Type
export class SourceError extends Schema.TaggedError<SourceError>()("SourceError", { message: Schema.String, kind: Schema.optional(Schema.Literals(["invalid-output", "provider"])) }) {}

export const emptyBrief = (name = "", url = ""): SourceBrief => ({
  name, seedUrls: url ? [url] : [], allowedDomains: url ? [new URL(url).hostname] : [], guidance: "",
  includePatterns: [], excludePatterns: [], requiredFields: ["title", "sourceUrl"], openOnly: true,
})
