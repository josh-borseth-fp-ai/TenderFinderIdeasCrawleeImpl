import { Schema } from "effect"

// This file ships inside every scraper package and is shared with the app.
const Texts = Schema.mutable(Schema.Array(Schema.String))
const NullableText = Schema.NullOr(Schema.String)
export const Strategy = Schema.Literals(["http", "cheerio", "playwright"])
export type Strategy = typeof Strategy.Type
export const BidStatus = Schema.Literals(["open", "closed", "awarded", "cancelled", "unknown"])
export const RouteSpec = Schema.Struct({ label: Schema.String, strategy: Strategy, waitFor: NullableText })
export const PageInput = Schema.Struct({ url: Schema.String, label: Schema.String, html: NullableText, json: Schema.Unknown })
export type PageInput = typeof PageInput.Type
export const RequestSpec = Schema.Struct({ url: Schema.String, label: Schema.String })
export type RequestSpec = typeof RequestSpec.Type
export const BidDraft = Schema.Struct({
  title: Schema.String, sourceUrl: Schema.String, evidence: Schema.String,
  buyer: Schema.optional(NullableText), solicitationId: Schema.optional(NullableText),
  description: Schema.optional(NullableText), status: Schema.optional(BidStatus),
  postedDate: Schema.optional(NullableText), deadline: Schema.optional(NullableText),
  deadlineRaw: Schema.optional(NullableText), location: Schema.optional(NullableText),
  categories: Schema.optional(Texts), attachmentLinks: Schema.optional(Texts),
  budget: Schema.optional(Schema.NullOr(Schema.Finite)), currency: Schema.optional(NullableText),
  budgetRaw: Schema.optional(NullableText), contactDetails: Schema.optional(NullableText),
  eligibility: Schema.optional(NullableText), submissionInstructions: Schema.optional(NullableText),
})
export type BidDraft = typeof BidDraft.Type
const Limits = Schema.Struct({
  maxPages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  maxRecords: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  timeoutSeconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
})
export const MANUAL_LIMITS = Limits.make({ maxPages: 1000, maxRecords: 10_000, timeoutSeconds: 1800 })
export const PREVIEW_LIMITS = Limits.make({ maxPages: 50, maxRecords: 200, timeoutSeconds: 600 })
export const REVIEW_SAMPLE_LIMIT = 20

export const Manifest = Schema.Struct({
  formatVersion: Schema.Literal(1), sourceId: Schema.String, revision: Schema.Int,
  entrypoint: Schema.Literal("scraper.ts"), seedUrls: Texts, allowedDomains: Texts,
  includePatterns: Texts, excludePatterns: Texts, routes: Schema.mutable(Schema.Array(RouteSpec)),
  limits: Schema.Struct({
    maxPages: Limits.fields.maxPages.check(Schema.isLessThanOrEqualTo(MANUAL_LIMITS.maxPages)),
    maxRecords: Limits.fields.maxRecords.check(Schema.isLessThanOrEqualTo(MANUAL_LIMITS.maxRecords)),
    timeoutSeconds: Limits.fields.timeoutSeconds.check(Schema.isLessThanOrEqualTo(MANUAL_LIMITS.timeoutSeconds)),
  }),
})
export type Manifest = typeof Manifest.Type
export const Evidence = Schema.Struct({
  ...PageInput.fields, finalUrl: Schema.String, strategy: Strategy,
  dom: Schema.optional(Schema.String), text: Schema.String, links: Texts,
})
export type Evidence = typeof Evidence.Type
const VisitedCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const RawRecords = Schema.mutable(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(MANUAL_LIMITS.maxRecords)))
export const RunnerBatch = Schema.Struct({ records: RawRecords, visitedCount: VisitedCount })
export type RunnerBatch = typeof RunnerBatch.Type
export const CollectionBatch = Schema.Struct({ complete: Schema.Boolean, pending: VisitedCount, processed: VisitedCount, expectedCount: Schema.NullOr(VisitedCount), issues: Texts })
export type CollectionBatch = typeof CollectionBatch.Type
export const RunnerResult = Schema.Struct({
  ...RunnerBatch.fields, visitedCount: Schema.mutableKey(VisitedCount), evidence: Schema.mutable(Schema.Array(Evidence)), errors: Texts, coverage: Schema.mutableKey(Schema.String),
  observedUrls: Schema.optional(Texts),
  expectedCount: Schema.optional(Schema.NullOr(VisitedCount)),
  collection: Schema.optional(CollectionBatch),
})
export type RunnerResult = typeof RunnerResult.Type
export const BrowserCheckpoint = Schema.Struct({ page: PageInput, cursor: Schema.String })
export type BrowserCheckpoint = typeof BrowserCheckpoint.Type
export const RuntimePin = Schema.Struct({
  image: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)), contractVersion: Schema.Literals([1, 2]),
})
export const PackageFiles = Schema.Record(Schema.String, Schema.String)
export type PackageFiles = typeof PackageFiles.Type
export const ControlState = Schema.Literals(["agent-controlled", "awaiting-human", "human-controlled", "closed"])
export type ControlState = typeof ControlState.Type

// Behavioral ports stay interfaces: their methods are capabilities, not serialized data.
/** All browser mutations pass through session ownership. No CDP or raw page. */
export interface BrowserActions {
  click(selector: string): Promise<void>
  fill(selector: string, value: string): Promise<void>
  select(selector: string, value: string): Promise<void>
  scroll(pixels: number): Promise<void>
  waitFor(selector: string): Promise<void>
  snapshot(): Promise<PageInput>
}
export interface ScraperModule {
  extract(input: PageInput): BidDraft[] | Promise<BidDraft[]>
  discover(input: PageInput): RequestSpec[] | Promise<RequestSpec[]>
  expectedCount?(input: PageInput): number | null
  browsePages?(browser: BrowserActions, input: PageInput, cursor: string | null): AsyncGenerator<BrowserCheckpoint>
  browse?(browser: BrowserActions, input: PageInput): Promise<PageInput[]>
}
