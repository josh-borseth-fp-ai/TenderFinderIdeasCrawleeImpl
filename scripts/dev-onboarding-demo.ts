/** Offline acceptance app: real Docker crawlers against fixture sites, scripted model.
 * Never imported by the production runtime. Uses a separate temporary database.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OnboardingService } from "../src/server/onboarding/Service.ts"
import { SourceStore } from "../src/server/onboarding/Store.ts"
import { DockerRunner } from "../src/server/onboarding/Runner.ts"
import { Schema } from "effect"
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
  if (!context.evidence.length) return { action: "inspect", url: context.brief.seedUrls[0]!, strategy: "playwright", reason: "Inspect the rendered fixture index" }
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
console.log(`Offline source demo: data in ${data}. Create a source with http://fixture.test/rendered`)
await import("../server.ts")
