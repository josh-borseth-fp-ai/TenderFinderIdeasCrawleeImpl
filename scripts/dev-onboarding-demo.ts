/** Offline acceptance app: real Docker crawlers against fixture sites, scripted model.
 * Never imported by the production runtime. Uses a separate temporary database.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OnboardingService } from "../src/server/onboarding/Service.ts"
import { SourceStore } from "../src/server/onboarding/Store.ts"
import { DockerRunner } from "../src/server/onboarding/Runner.ts"
import { Effect, Layer, ManagedRuntime, Option, Redacted, Schema, Stream } from "effect"
import { ChatService } from "../src/server/ChatService.ts"
import { ConversationIntentModel } from "../src/server/ConversationIntentModel.ts"
import { SourceModel } from "../src/server/onboarding/SourceModel.ts"
import { AppConfig } from "../src/server/AppConfig.ts"
import { SourceBrief, type AgentDecision } from "../src/domain/Source.ts"
import "../src/server/onboarding/Runtime.ts"

const data = process.env.DEMO_DATA_DIR ?? mkdtempSync(join(tmpdir(), "bid-desk-demo-"))
const runner = new DockerRunner(undefined, "offline-demo")
const code = `import { load } from 'cheerio';
import type { PageInput, BidDraft, RequestSpec } from './contract.ts';
export function extract(input: PageInput): BidDraft[] {
  const $ = load(input.html || '');
  return $('h1').length ? [{ title: $('h1').text(), sourceUrl: input.url, buyer: $('[data-buyer]').text(), status: 'open', evidence: $('main').text() }] : [];
}
export function discover(input: PageInput): RequestSpec[] {
  const $ = load(input.html || '');
  return $('a[href]').map((_, el) => ({ url: new URL($(el).attr('href')!, input.url).href, label: 'detail' })).get();
}`
globalThis.__onboardingService = new OnboardingService(new SourceStore(data), {
  identity: (signal) => runner.identity(signal),
  run: (files, domains, options) => runner.run(files, domains, { ...options, fixture: true }),
}, async (prompt): Promise<AgentDecision> => {
  const context = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ brief: SourceBrief, evidence: Schema.Array(Schema.Struct({ finalUrl: Schema.String })) })))(prompt)
  const many = context.brief.seedUrls[0]?.endsWith("/many")
  if (!context.evidence.length) return { action: "inspect", url: context.brief.seedUrls[0]!, strategy: many ? "http" : "playwright", reason: "Inspect the fixture index" }
  if (many) return { action: "generate", package: {
    rationale: "The observed JSON feed contains the complete opportunity collection.", runbook: "Deterministic large collection fixture. Collect every JSON record.", routes: [{ label: "index", strategy: "http", waitFor: null }],
    code: `import { Schema } from 'effect'; import { BidDraft, type PageInput } from './contract.ts';
const Feed = Schema.Struct({ bids: Schema.mutable(Schema.Array(BidDraft)) });
export function extract(input: PageInput) { return Schema.decodeUnknownSync(Feed)(input.json).bids; }
export function discover() { return []; }
export function expectedCount(input: PageInput) { return Schema.decodeUnknownSync(Feed)(input.json).bids.length; }`,
    tests: `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { Schema } from 'effect'; import { Evidence } from './contract.ts'; import { extract } from './scraper.ts';
const fixtures = Schema.decodeSync(Schema.fromJsonString(Schema.Array(Evidence)))(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
test('extracts all observed opportunities without a sample cap', () => { const page = fixtures[0]; assert.ok(page); const rows = extract(page); assert.equal(rows.length, 10005); assert.equal(rows[0]?.title, 'Opportunity 0'); assert.equal(rows.at(-1)?.title, 'Opportunity 10004'); });`,
  } }
  if (!context.evidence.some((page) => page.finalUrl.endsWith("/detail"))) return { action: "inspect", url: "http://fixture.test/detail", strategy: "cheerio", reason: "Read a representative bid detail" }
  return { action: "generate", package: {
    rationale: "The fixture index renders links using JavaScript; bid details are static HTML. Use Playwright for the index and Cheerio for details.",
    routes: [{ label: "index", strategy: "playwright", waitFor: "main a" }, { label: "detail", strategy: "cheerio", waitFor: null }],
    runbook: "## Demo source\n\nThis is a deterministic test site, not a real procurement source. Collect the Bridge repair opportunity from the rendered index and the City Works buyer from its detail page. Missing commercial fields stay null.\n\n## Validation\n\nFixture tests compare the observed title and buyer; live validation uses the same isolated test server. Review warnings for absent deadlines.", code,
    tests: `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { extract, discover } from './scraper.ts';
import { Schema } from 'effect'; import { Evidence } from './contract.ts';
const fixtures = Schema.decodeSync(Schema.fromJsonString(Schema.Array(Evidence)))(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
test('extracts title and buyer from the observed detail', () => { const fixture = fixtures.find((page) => page.finalUrl.endsWith('/detail')); assert.ok(fixture); const rows = extract({...fixture, url: fixture.finalUrl, label: 'detail'}); assert.equal(rows[0]?.title, 'Bridge repair'); assert.equal(rows[0]?.buyer, 'City Works'); });
test('discovers the detail from rendered index', () => { const fixture = fixtures.find((page) => !page.finalUrl.endsWith('/detail')); assert.ok(fixture); assert.ok(discover({...fixture, url: fixture.finalUrl, label: 'index'}).some(row => row.url === 'http://fixture.test/detail')); });`,
  } }
})
globalThis.__serverRuntime = ManagedRuntime.make(Layer.mergeAll(
  Layer.succeed(AppConfig, { apiKey: Redacted.make("fixture"), model: "fixture", apiUrl: Option.none(), siteUrl: Option.none(), siteTitle: Option.none() }),
  Layer.succeed(ChatService, { stream: () => Stream.fromIterable([{ _tag: "TextDelta" as const, delta: "Paste a website URL to find opportunities, or adjust what to find in the same conversation." }, { _tag: "Done" as const }]) }),
  Layer.succeed(SourceModel, { decide: () => Effect.succeed({ action: "question" as const, message: "Fixture onboarding uses its injected source service." }) }),
  Layer.succeed(ConversationIntentModel, { decide: (context) => {
    const value = Schema.decodeSync(Schema.fromJsonString(Schema.Struct({ messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.String })), sources: Schema.Array(Schema.Struct({ id: Schema.String })), selectedSourceId: Schema.NullOr(Schema.String) })))(context)
    const content = value.messages.at(-1)?.content ?? ""
    if (/show.*sources/i.test(content)) return Effect.succeed({ action: "sources" as const })
    const sourceId = value.selectedSourceId ?? (value.sources.length === 1 ? value.sources[0]?.id : undefined)
    if (sourceId && /only|include|exclude|for |collect/i.test(content)) return Effect.succeed({ action: "refine" as const, sourceId, guidance: content, openOnly: null })
    return Effect.succeed({ action: "chat" as const })
  } }),
))
console.log(`Offline source demo: data in ${data}. Paste http://fixture.test/rendered into the main chat`)
await import("../server.ts")
