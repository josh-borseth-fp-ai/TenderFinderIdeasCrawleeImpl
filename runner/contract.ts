export interface PageInput {
  url: string
  label: string
  html: string | null
  json: unknown
}
export interface RequestSpec { url: string; label: string }
export interface BidDraft {
  title: string
  sourceUrl: string
  evidence: string
  buyer?: string | null
  solicitationId?: string | null
  description?: string | null
  status?: "open" | "closed" | "awarded" | "cancelled" | "unknown"
  postedDate?: string | null
  deadline?: string | null
  deadlineRaw?: string | null
  location?: string | null
  categories?: string[]
  attachmentLinks?: string[]
  budget?: number | null
  currency?: string | null
  budgetRaw?: string | null
  contactDetails?: string | null
  eligibility?: string | null
  submissionInstructions?: string | null
}
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
  browse?(browser: BrowserActions, input: PageInput): Promise<PageInput[]>
}
export interface Manifest {
  formatVersion: 1
  sourceId: string
  revision: number
  entrypoint: "scraper.ts"
  seedUrls: string[]
  allowedDomains: string[]
  includePatterns: string[]
  excludePatterns: string[]
  routes: { label: string; strategy: "http" | "cheerio" | "playwright"; waitFor: string | null }[]
  limits: { maxPages: number; maxRecords: number; timeoutSeconds: number }
}
