import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { Schema } from "effect"
import { BidDraft, type Manifest, type Strategy } from "../runner/contract.ts"
import assert from "node:assert/strict"
import { DockerRunner } from "../src/server/onboarding/Runner.ts"
import { runtimeFile } from "../src/server/onboarding/Packages.ts"

const runner = new DockerRunner(), signal = new AbortController().signal
const runtime = { image: await runner.identity(signal), contractVersion: 1 }
const manifest = (strategy: Strategy, url: string, mixed = false): Manifest => ({
  formatVersion: 1, sourceId: "fixture-source", revision: 1, entrypoint: "scraper.ts", seedUrls: [url], allowedDomains: ["fixture.test"],
  includePatterns: [], excludePatterns: ["/excluded"],
  routes: [{ label: "index", strategy, waitFor: strategy === "playwright" ? "main a" : null }, { label: "detail", strategy: mixed ? "cheerio" : strategy, waitFor: null }],
  limits: { maxPages: 10, maxRecords: 20, timeoutSeconds: 90 },
})
const code = `import { load } from 'cheerio';
import { Schema } from 'effect';
import { BidDraft, type PageInput, type RequestSpec } from './contract.ts';
export function extract(input: PageInput): BidDraft[] {
  if (input.json) return Schema.decodeUnknownSync(Schema.Struct({ bids: Schema.mutable(Schema.Array(BidDraft)) }))(input.json).bids;
  const $ = load(input.html || '');
  return $('h1').length ? [{ title: $('h1').text(), sourceUrl: input.url, buyer: $('[data-buyer]').text(), status: 'open', evidence: $('main').text() }] : [];
}
export function discover(input: PageInput): RequestSpec[] {
  if (input.json) return [];
  const $ = load(input.html || '');
  return $('a[href]').map((_, el) => ({ url: new URL($(el).attr('href')!, input.url).href, label: $(el).attr('href') === '/page2' ? 'index' : 'detail' })).get();
}`
const baseFiles = { "scraper.ts": code, "contract.ts": runtimeFile("contract.ts"), "package.json": '{"type":"module"}', "runtime.json": JSON.stringify(runtime) }
for (const [strategy, path, mixed] of [["cheerio", "/", false], ["http", "/json", false], ["playwright", "/rendered", false], ["playwright", "/rendered", true]] as const) {
  console.log(`Checking ${strategy}${mixed ? " → Cheerio" : ""}`)
  const result = await runner.run({ ...baseFiles, "manifest.json": JSON.stringify(manifest(strategy, `http://fixture.test${path}`, mixed)) }, ["fixture.test"], { signal, timeoutSeconds: 120, fixture: true })
  assert.deepEqual(result.errors, [], JSON.stringify(result))
  assert.equal(Schema.decodeUnknownSync(BidDraft)(result.records[0]).title, "Bridge repair", JSON.stringify(result))
  assert.ok(result.visitedCount > 0)
}
console.log("Checking shared page budget and deduplication across all three strategies")
const mixedManifest = manifest("playwright", "http://fixture.test/rendered", true)
const boundedManifest: Manifest = {
  ...mixedManifest,
  routes: [...mixedManifest.routes, { label: "api", strategy: "http", waitFor: null }],
  limits: { ...mixedManifest.limits, maxPages: 3 },
}
const bounded = await runner.run({
  ...baseFiles,
  "manifest.json": JSON.stringify(boundedManifest),
  "scraper.ts": code.slice(0, code.indexOf("export function discover")) + `
export function discover(input: PageInput): RequestSpec[] {
  return input.label === 'index' ? [
    { url: 'http://fixture.test/detail', label: 'detail' },
    { url: 'http://fixture.test/detail', label: 'detail' },
    { url: 'http://fixture.test/json', label: 'api' },
    { url: 'http://fixture.test/page2', label: 'index' },
  ] : [];
}`,
}, ["fixture.test"], { signal, timeoutSeconds: 120, fixture: true })
assert.deepEqual(bounded.errors, [], JSON.stringify(bounded))
assert.equal(bounded.visitedCount, 3, "One shared page budget, with duplicates handled by Crawlee")
assert.equal(bounded.records.length, 2, "Cheerio and HTTP both run after the Playwright index")
assert.match(bounded.coverage, /Bounded at 3 pages/)
console.log("Checking persistent queues and full collection across bounded batches")
const collectionFiles = { ...baseFiles, "runtime.json": JSON.stringify({ ...runtime, contractVersion: 2 }), "scraper.ts": code.slice(0, code.indexOf("export function discover")) + `
export function discover(input: PageInput): RequestSpec[] {
  const data = Schema.decodeUnknownSync(Schema.Struct({ next: Schema.NullOr(Schema.String) }))(input.json);
  return data.next ? [{ url: data.next, label: 'index' }] : [];
}` }
for (const path of ["/pages", "/many"]) {
  const directory = mkdtempSync(join(tmpdir(), "collection-test-"))
  const records = new Map<string, unknown>()
  let batches = 0
  try {
    for (;;) {
      const m = { ...manifest("http", `http://fixture.test${path}`), limits: { maxPages: 2, maxRecords: 3, timeoutSeconds: 120 } }
      const result = await runner.run({ ...collectionFiles, "manifest.json": JSON.stringify(m) }, ["fixture.test"], { signal, timeoutSeconds: 150, fixture: true, collectionDirectory: directory, onRecords: (items) => { for (const item of items) { const record = Schema.decodeUnknownSync(BidDraft)(item); records.set(record.sourceUrl, record) } } })
      assert.deepEqual(result.errors, [], JSON.stringify(result))
      assert.equal(result.records.length, 0, "Collection transport streams records instead of buffering the dataset")
      assert.ok(++batches < 10, "Must make progress across batches")
      if (result.collection?.complete) break
      assert.ok(result.collection?.pending, JSON.stringify(result))
    }
    assert.equal(records.size, path === "/many" ? 10005 : 5)
    if (path === "/pages") assert.ok(batches >= 3, "Must resume after the page limit")
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
console.log("Checking resumable browser pagination")
const browserDirectory = mkdtempSync(join(tmpdir(), "browser-collection-test-"))
try {
  const records = new Set<string>()
  const files = { ...baseFiles, "runtime.json": JSON.stringify({ ...runtime, contractVersion: 2 }), "manifest.json": JSON.stringify({ ...manifest("playwright", "http://fixture.test/interactive"), routes: [{ label: "index", strategy: "playwright", waitFor: "h1" }], limits: { maxPages: 2, maxRecords: 3, timeoutSeconds: 120 } }), "scraper.ts": `import { load } from 'cheerio';
export function extract(input) { const title = load(input.html)('h1').text(); return [{ title, sourceUrl: input.url + '?item=' + title.split(' ').at(-1), status: 'open', evidence: title }]; }
export function discover() { return []; }
export async function* browsePages(browser, input, cursor) {
  let n = Number(cursor || 0);
  for (let i=0; i<n; i++) await browser.click('#next');
  while (n < 4) { await browser.click('#next'); n++; const page = await browser.snapshot(); yield { page, cursor: String(n) }; }
}` }
  for (let batch = 0; ; batch++) {
    assert.ok(batch < 8)
    const result = await runner.run(files, ["fixture.test"], { signal, timeoutSeconds: 150, fixture: true, collectionDirectory: browserDirectory, onRecords: (items) => { for (const item of items) records.add(Schema.decodeUnknownSync(BidDraft)(item).sourceUrl) } })
    assert.deepEqual(result.errors, [], JSON.stringify(result))
    if (result.collection?.complete) break
    assert.ok(result.collection?.pending, JSON.stringify(result))
  }
  assert.equal(records.size, 5)
} finally { rmSync(browserDirectory, { recursive: true, force: true }) }
console.log("Checking investigation snapshots")
const inspected = await runner.run({ "manifest.json": JSON.stringify(manifest("playwright", "http://fixture.test/rendered")) }, ["fixture.test"], { signal, timeoutSeconds: 90, inspect: true, fixture: true })
assert.ok(inspected.evidence[0]?.html?.includes("Bridge repair"))
const largeInspection = await runner.run({ "manifest.json": JSON.stringify(manifest("http", "http://fixture.test/many")) }, ["fixture.test"], { signal, timeoutSeconds: 90, inspect: true, fixture: true })
assert.equal(Schema.decodeUnknownSync(Schema.Struct({ bids: Schema.Array(BidDraft) }))(largeInspection.evidence[0]?.json).bids.length, 10005, "Large inspection output must drain before worker exit")
console.log("Checking explicit empty-source evidence")
const empty = await runner.run({ ...baseFiles, "manifest.json": JSON.stringify(manifest("http", "http://fixture.test/empty")), "scraper.ts": code + `\nexport function expectedCount(input: PageInput) { return Schema.decodeUnknownSync(Schema.Struct({ total: Schema.Int }))(input.json).total; }` }, ["fixture.test"], { signal, timeoutSeconds: 90, fixture: true })
assert.deepEqual(empty.errors, [])
assert.deepEqual(empty.records, [])
assert.equal(empty.expectedCount, 0)
console.log("Checking offline fixture tests")
await runner.run({ ...baseFiles, "scraper.test.ts": `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { extract } from './scraper.ts'; test('extracts observed bid', () => { assert.equal(extract({ url: 'http://fixture.test/detail', label: 'detail', html: '<main><h1>Bridge repair</h1></main>', json: null })[0]?.title, 'Bridge repair'); });` }, [], { signal, timeoutSeconds: 90, test: true })
console.log("Checking empty and skipped fixture rejection")
for (const tests of ["", "import { test } from 'node:test'; test.skip('never runs', () => {})"]) {
  await assert.rejects(runner.run({ ...baseFiles, "scraper.test.ts": tests }, [], { signal, timeoutSeconds: 90, test: true }), /no tests executed/)
}
console.log("Checking malformed worker checkpoint rejection")
await assert.rejects(runner.run({
  ...baseFiles, "manifest.json": JSON.stringify(manifest("cheerio", "http://fixture.test/detail")),
  "scraper.ts": `console.log('BID_DESK_BATCH={"records":[],"visitedCount":-1}'); export const extract = () => []; export const discover = () => [];`,
}, ["fixture.test"], { signal, timeoutSeconds: 90, fixture: true }), /visitedCount/)
console.log("Checking redirects to private destinations")
const blocked = await runner.run({ ...baseFiles, "manifest.json": JSON.stringify(manifest("http", "http://fixture.test/private-redirect")) }, ["fixture.test"], { signal, timeoutSeconds: 90, fixture: true })
assert.ok(blocked.errors.length > 0)
console.log("Checking robots exclusions")
const forbidden = await runner.run({ ...baseFiles, "manifest.json": JSON.stringify(manifest("cheerio", "http://fixture.test/forbidden")) }, ["fixture.test"], { signal, timeoutSeconds: 90, fixture: true })
assert.equal(forbidden.visitedCount, 0)
assert.ok(forbidden.errors.length > 0)
console.log("Checking direct network isolation")
const isolated = execFileSync("docker", ["run", "--rm", "--network=none", "--user=1000:1000", "--cap-drop=ALL", "--security-opt=no-new-privileges", "bid-desk-runner:1", "node", "--input-type=module", "-e", "import net from 'node:net'; const s=net.connect({host:'1.1.1.1',port:80}); s.on('connect',()=>process.exit(1)); s.on('error',()=>process.exit(0)); setTimeout(()=>process.exit(0),1000);"])
assert.equal(isolated.toString(), "")
console.log("Checking execution deadline and cleanup")
await assert.rejects(runner.run({ ...baseFiles, "manifest.json": JSON.stringify(manifest("cheerio", "http://fixture.test/detail")), "scraper.ts": "export function extract() { while (true) {} } export function discover() { return [] }" }, ["fixture.test"], { signal, timeoutSeconds: 5, fixture: true }), /deadline exceeded/)
const leaked = execFileSync("docker", ["ps", "-aq", "--filter", "label=bid-desk.owner=standalone"])
assert.equal(leaked.toString().trim(), "", "Standalone runner containers should be removed after a timeout")
console.log("All isolated runner checks passed.")
