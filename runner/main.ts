import { Schema } from "effect"
import { Mutex, Semaphore } from "async-mutex"
import { createServer, connect } from "node:net"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { HttpCrawler, CheerioCrawler, PlaywrightCrawler, ProxyConfiguration, Configuration, RequestQueue, Log, LogLevel, type BasicCrawler } from "crawlee"
import { RobotsTxtFile } from "@crawlee/utils"
import { load } from "cheerio"
import { chromium } from "playwright"
import { BrowserSession } from "./session.ts"
import { Manifest, PageInput, RequestSpec, BidDraft, RunnerResult, type BrowserActions, type ScraperModule, type Strategy } from "./contract.ts"

const manifest = Schema.decodeSync(Schema.fromJsonString(Manifest))(readFileSync("/work/manifest.json", "utf8"))
const inspect = process.argv.includes("--inspect")
const output: RunnerResult = {
  records: [], evidence: [], errors: [], visitedCount: 0, coverage: "All discovered in-scope requests processed.",
}
// The container has --network none. This loopback proxy is its only network path;
// the Unix socket is served by a separate trusted container over a named volume.
const forwarder = createServer((client) => {
  const upstream = connect("/proxy/egress.sock")
  client.pipe(upstream); upstream.pipe(client)
  client.on("error", () => upstream.destroy()); upstream.on("error", () => client.destroy())
  client.on("close", () => upstream.destroy()); upstream.on("close", () => client.destroy())
})
await new Promise<void>((resolve) => forwarder.listen(3128, "127.0.0.1", resolve))
const proxyUrl = "http://127.0.0.1:3128"
const proxyConfiguration = new ProxyConfiguration({ proxyUrls: [proxyUrl] })
const config = new Configuration({ persistStorage: false, purgeOnStart: false })
const module: ScraperModule | null = inspect ? null : await import(pathToFileURL("/work/scraper.ts").href)
if (module && (typeof module.extract !== "function" || typeof module.discover !== "function")) throw new Error("Package must export extract and discover")
const crawlers = new Map<string, Pick<BasicCrawler, "stop" | "addRequests" | "run" | "teardown">>()
const queues = new Map<string, RequestQueue>()
const admission = new Mutex()
let admitted = 0
const robots = new Map<string, Promise<RobotsTxtFile>>()
const sessions = new Set<BrowserSession>()
let outstanding = 0, stopped = false
const hosts = new Map<string, { slots: Semaphore; nextStart: number }>()
const releases = new Map<string, () => void>()
async function acquire(request: { url: string; uniqueKey: string }) {
  const host = new URL(request.url).hostname
  let gate = hosts.get(host)
  if (!gate) { gate = { slots: new Semaphore(2), nextStart: 0 }; hosts.set(host, gate) }
  const [, unlock] = await gate.slots.acquire()
  releases.set(request.uniqueKey, unlock)
  const start = Math.max(Date.now(), gate.nextStart)
  gate.nextStart = start + 1000
  if (start > Date.now()) await new Promise((resolve) => setTimeout(resolve, start - Date.now()))
}
function release(request: { uniqueKey: string }) { releases.get(request.uniqueKey)?.(); releases.delete(request.uniqueKey) }
const pattern = (url: string, rule: string) => new RegExp(rule.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"), "i").test(url)
function allowed(value: string) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !manifest.allowedDomains.includes(url.hostname)) throw new Error(`Outside source scope: ${url.hostname}`)
  if (manifest.excludePatterns.some((rule) => pattern(url.href, rule))) return false
  return true
}
function stop() { if (stopped) return; stopped = true; for (const crawler of crawlers.values()) crawler.stop() }
function complete(request: { uniqueKey: string }) { release(request); outstanding--; if (outstanding === 0) stop() }
const enqueue = (spec: RequestSpec) => admission.runExclusive(async () => {
  if (stopped) return
  const url = new URL(spec.url); url.hash = ""
  if (!allowed(url.href)) return
  const route = manifest.routes.find((route) => route.label === spec.label)
  if (!route) throw new Error(`Unknown route label: ${spec.label}`)
  const key = `${spec.label}:${url.href}`
  if (admitted >= manifest.limits.maxPages) { output.coverage = `Bounded at ${manifest.limits.maxPages} pages; more requests were discovered.`; return }
  const origin = url.origin
  if (!robots.has(origin)) robots.set(origin, RobotsTxtFile.find(url.href, proxyUrl, { timeoutMillis: 20_000 }))
  const rules = await robots.get(origin)!
  if (!rules.isAllowed(url.href)) { output.coverage = "Some discovered URLs were excluded by robots.txt."; return }
  outstanding++
  try {
    const result = await queues.get(route.strategy)!.addRequest({ url: url.href, uniqueKey: key, userData: { label: spec.label } })
    if (result.wasAlreadyPresent) outstanding--
    else admitted++
  } catch (error) { outstanding--; throw error }
})
async function consume(input: PageInput, strategy: Strategy) {
  if (!allowed(input.url)) throw new Error("Redirected to an excluded URL")
  output.visitedCount++
  if (inspect) {
    const $ = load(input.html ?? "")
    const links = $("a[href]").map((_i, element) => { try { return new URL($(element).attr("href")!, input.url).href } catch { return "" } }).get().filter(Boolean).slice(0, 200)
    $("script,style,noscript,svg").remove()
    output.evidence.push({ ...input, url: manifest.seedUrls[0] ?? input.url, finalUrl: input.url, strategy, dom: $.html().slice(0, 60_000), text: $.text().replace(/\s+/g, " ").trim().slice(0, 20_000), links })
    return
  }
  const records = Schema.decodeUnknownSync(Schema.Array(BidDraft))(await module!.extract(input))
  const $ = load(input.html ?? "")
  $("script,style,noscript").remove()
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase()
  const observed = normalize(input.html !== null ? $.text() : JSON.stringify(input.json))
  for (const record of records) {
    if (typeof record.title !== "string" || typeof record.evidence !== "string" || !normalize(record.title) || !normalize(record.evidence)) throw new Error("Every record needs a title and observed source evidence")
    if (!observed.includes(normalize(record.evidence))) throw new Error(`Evidence was not found on the fetched page: ${record.title}`)
  }
  const available = manifest.limits.maxRecords - output.records.length
  const batch = records.slice(0, available)
  output.records.push(...batch)
  console.log(`BID_DESK_BATCH=${JSON.stringify({ records: batch, visitedCount: output.visitedCount })}`)
  if (output.records.length >= manifest.limits.maxRecords) { output.coverage = `Bounded at ${manifest.limits.maxRecords} extracted records.`; stop(); return }
  const discovered = Schema.decodeUnknownSync(Schema.Array(RequestSpec).check(Schema.isMaxLength(10_000)))(await module!.discover(input))
  for (const request of discovered) await enqueue({ ...request, url: new URL(request.url, input.url).href })
}
for (const strategy of new Set(manifest.routes.map((route) => route.strategy))) {
  const requestQueue = await RequestQueue.open(strategy, { config })
  queues.set(strategy, requestQueue)
  const common = {
    requestQueue, proxyConfiguration, keepAlive: true, maxConcurrency: 1, maxRequestRetries: 2,
    maxRequestsPerMinute: 60, requestHandlerTimeoutSecs: 90, useSessionPool: false,
    log: new Log({ level: LogLevel.OFF }),
    errorHandler: async ({ request }: { request: { uniqueKey: string } }) => { release(request) },
    failedRequestHandler: async ({ request }: { request: { url: string; uniqueKey: string } }, error: Error) => { output.errors.push(`${request.url}: ${error.message}`); complete(request) },
  }
  if (strategy === "playwright") {
    crawlers.set(strategy, new PlaywrightCrawler({
      ...common,
      launchContext: { launcher: chromium, launchOptions: { headless: true, args: ["--disable-quic", "--disable-dev-shm-usage"] } },
      browserPoolOptions: { useFingerprints: true },
      preNavigationHooks: [async ({ page, request }) => {
        await acquire(request)
        await page.route("**/*", async (route) => { try { if (allowed(route.request().url())) await route.continue(); else await route.abort() } catch { await route.abort() } })
      }],
      requestHandler: async ({ page, request, response }) => {
        if ((response?.status() ?? 200) >= 400) throw new Error(`HTTP ${response?.status()}`)
        const label = String(request.userData.label)
        const waitFor = manifest.routes.find((route) => route.label === label)?.waitFor
        if (waitFor) await page.locator(waitFor).first().waitFor({ timeout: 15_000 })
        const session = new BrowserSession(request.id ?? request.url)
        sessions.add(session)
        try {
          const snapshot = (): Promise<PageInput> => session.agent(async () => ({ url: page.url(), label, html: (await page.content()).slice(0, 5 * 1024 * 1024), json: null }))
          const input = await snapshot()
          const bodyText = await page.locator("body").innerText()
          if (/verify (?:that )?you are human|complete the captcha|sign in to (?:view|continue)|access denied/i.test(bodyText) && bodyText.length < 8000) throw new Error("Human intervention required: login or CAPTCHA barrier. Live takeover is a follow-up feature.")
          await consume(input, strategy)
          if (module?.browse && !stopped) {
            const actions: BrowserActions = {
              click: (selector) => session.agent(() => page.locator(selector).first().click()),
              fill: (selector, value) => session.agent(() => page.locator(selector).first().fill(value)),
              select: (selector, value) => session.agent(async () => { await page.locator(selector).first().selectOption(value) }),
              scroll: (pixels) => session.agent(() => page.mouse.wheel(0, Math.max(-2000, Math.min(2000, pixels)))),
              waitFor: (selector) => session.agent(() => page.locator(selector).first().waitFor({ timeout: 15_000 })),
              snapshot,
            }
            for (const extra of Schema.decodeUnknownSync(Schema.Array(PageInput))(await module.browse(actions, input)).slice(0, manifest.limits.maxPages - output.visitedCount)) { if (stopped) break; await consume(extra, strategy) }
          }
        } finally { session.close(); sessions.delete(session) }
        complete(request)
      },
    }, config))
  } else {
    const Crawler = strategy === "http" ? HttpCrawler : CheerioCrawler
    crawlers.set(strategy, new Crawler({
      ...common, additionalMimeTypes: ["application/json"],
      preNavigationHooks: [async ({ request }) => { await acquire(request) }],
      requestHandler: async ({ request, body, contentType, response }) => {
        if ((response.statusCode ?? 200) >= 400) throw new Error(`HTTP ${response.statusCode}`)
        const text = typeof body === "string" ? body : body.toString("utf8")
        if (Buffer.byteLength(text) > 5 * 1024 * 1024) throw new Error("Response exceeds 5 MiB")
        const json = contentType.type.includes("json") ? Schema.decodeSync(Schema.fromJsonString(Schema.Unknown))(text) : null
        await consume({ url: request.loadedUrl ?? request.url, label: String(request.userData.label), html: json === null ? text : null, json }, strategy)
        complete(request)
      },
    }, config))
  }
}
try {
  // Queue all seeds before starting workers, so an early completion cannot stop a
  // sibling seed or a different strategy before it is registered.
  for (const url of manifest.seedUrls) await enqueue({ url, label: "index" })
  if (outstanding) await Promise.all([...crawlers.values()].map((crawler) => crawler.run()))
  else output.errors.push("No crawlable seed URLs (check exclusions and robots.txt).")
} catch (error) { output.errors.push(error instanceof Error ? error.message : String(error)) }
finally {
  stop()
  for (const session of sessions) session.close()
  await Promise.allSettled([...crawlers.values()].map((crawler) => crawler.teardown()))
  forwarder.close()
  console.log(`BID_DESK_RESULT=${JSON.stringify(output)}`)
}
process.exit(output.errors.length ? 1 : 0)
