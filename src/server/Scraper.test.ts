import { describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import { Readable } from "node:stream"
import { Scraper } from "./Scraper.ts"

const fixture = vi.hoisted(() => ({ calls: 0, aborted: 0 }))
vi.mock("./ScrapeHttpClient.ts", async (original) => {
  const actual = await original<typeof import("./ScrapeHttpClient.ts")>()
  const { GotScrapingHttpClient } = await import("crawlee")
  return {
    ...actual,
    ScrapeHttpClient: class extends GotScrapingHttpClient {
      constructor(private readonly signal: AbortSignal) { super() }
      override async stream(request: import("crawlee").HttpRequest) {
        fixture.calls++
        const path = new URL(request.url).pathname
        if (path === "/fail") throw new Error("Fixture request failed")
        if (path === "/slow") {
          await new Promise<void>((_resolve, reject) => {
            const abort = () => { fixture.aborted++; reject(new Error("Aborted")) }
            if (this.signal.aborted) abort()
            else this.signal.addEventListener("abort", abort, { once: true })
          })
        }
        const html = path === "/long" ? `<main>${"x".repeat(20_001)}</main>`
          : path === "/article" ? "<article>Article text</article><p>Outside</p>"
          : path === "/body" ? "<body><p>Body text</p></body>"
          : `<title> Sample page </title><nav>Ignore</nav><main><h1>Hello</h1><p>${path}</p><script>secret</script><style>css</style><span hidden>hidden</span></main><article>Ignore article</article>`
        return {
          stream: Readable.from([Buffer.from(html)]), request, url: `${request.url}?final`,
          statusCode: path === "/404" ? 404 : 200, headers: { "content-type": "text/html" }, trailers: {},
          complete: true, redirectUrls: [],
          downloadProgress: { percent: 1, transferred: html.length },
          uploadProgress: { percent: 1, transferred: 0 },
        }
      }
    },
  }
})

const scrape = (path: string) => Effect.flatMap(Scraper, (service) => service.scrape({ url: `https://example.com${path}` })).pipe(Effect.provide(Scraper.layer))

describe("Scraper with Crawlee and fixture transport", () => {
  it("extracts main text and metadata without scripts or navigation", async () => {
    const result = await Effect.runPromise(scrape("/main"))
    expect(result).toEqual({ url: "https://example.com/main", finalUrl: "https://example.com/main?final", title: "Sample page", text: "Hello /main", truncated: false })
  })
  it("falls back to article and body, and bounds returned text", async () => {
    expect((await Effect.runPromise(scrape("/article"))).text).toBe("Article text")
    expect((await Effect.runPromise(scrape("/body"))).text).toBe("Body text")
    const result = await Effect.runPromise(scrape("/long"))
    expect(result.text).toHaveLength(20_000)
    expect(result.truncated).toBe(true)
  })
  it("isolates concurrent and repeated URLs", async () => {
    const results = await Promise.all([scrape("/a"), scrape("/b"), scrape("/a")].map((effect) => Effect.runPromise(effect)))
    expect(results.map((result) => result.text)).toEqual(["Hello /a", "Hello /b", "Hello /a"])
  })
  it("retries once and reports failure", async () => {
    const before = fixture.calls
    await expect(Effect.runPromise(scrape("/fail"))).rejects.toThrow("Fixture request failed")
    expect(fixture.calls - before).toBe(2)
  })
  it("reports HTTP errors instead of returning the error page as content", async () => {
    await expect(Effect.runPromise(scrape("/404"))).rejects.toThrow("404")
  })
  it("aborts active HTTP work when interrupted", async () => {
    const before = fixture.aborted
    const controller = new AbortController()
    const promise = Effect.runPromise(scrape("/slow"), { signal: controller.signal })
    setTimeout(() => controller.abort(), 250)
    await expect(promise).rejects.toThrow()
    expect(fixture.aborted).toBeGreaterThan(before)
  })
  it("times out the entire operation and cleans up", async () => {
    const before = fixture.aborted
    await expect(Effect.runPromise(scrape("/slow"))).rejects.toThrow("Scraping timed out after 30 seconds")
    expect(fixture.aborted).toBeGreaterThan(before)
  }, 40_000)
})
