import { Context, Effect, Layer } from "effect"
import { CheerioCrawler, Configuration, Log, LogLevel } from "crawlee"
import { MemoryStorage } from "@crawlee/memory-storage"
import { ScrapeError, type ScrapeResult } from "../domain/Scrape.ts"
import { publicUrl, ScrapeHttpClient } from "./ScrapeHttpClient.ts"

const MAX_TEXT_LENGTH = 20_000
const TIMEOUT_MS = 30_000

const scrape = ({ url: input }: { readonly url: string }) => Effect.scoped(
  Effect.gen(function* () {
    const storage = new MemoryStorage({
      persistStorage: false,
      writeMetadata: false,
      localDataDirectory: `/tmp/crawlee-${crypto.randomUUID()}`,
    })
    let crawler: CheerioCrawler | undefined
    let running: Promise<unknown> | undefined
    yield* Effect.addFinalizer(() => Effect.promise(async () => {
      await crawler?.teardown()
      await running?.catch(() => undefined)
      await storage.teardown()
    }))
    // Registered after cleanup so scope closure aborts HTTP before awaiting it.
    const signal = yield* Effect.abortSignal
    return yield* Effect.tryPromise({
      try: async () => {
        const url = publicUrl(input).href
        let result: ScrapeResult | undefined
        let failure: Error | undefined
        crawler = new CheerioCrawler({
          httpClient: new ScrapeHttpClient(signal),
          maxRequestsPerCrawl: 1,
          maxConcurrency: 1,
          maxRequestRetries: 1,
          additionalHttpErrorStatusCodes: Array.from({ length: 100 }, (_, index) => 400 + index),
          useSessionPool: false,
          navigationTimeoutSecs: 25,
          requestHandlerTimeoutSecs: 25,
          log: new Log({ level: LogLevel.OFF }),
          requestHandler: async ({ $, request }) => {
            $("script, style, noscript, template, nav, footer, header, aside, svg, [hidden], [aria-hidden='true']").remove()
            const main = $("main").first()
            const article = $("article").first()
            const root = main.length ? main : article.length ? article : $("body")
            root.find("br, p, div, section, li, h1, h2, h3, h4, h5, h6, tr").append(" ")
            const text = root.text().replace(/\s+/g, " ").trim()
            result = {
              url,
              finalUrl: request.loadedUrl ?? url,
              title: $("title").text().replace(/\s+/g, " ").trim(),
              text: text.slice(0, MAX_TEXT_LENGTH),
              truncated: text.length > MAX_TEXT_LENGTH,
            }
          },
          failedRequestHandler: async (_context, error) => { failure = error },
        }, new Configuration({ storageClient: storage, persistStorage: false, purgeOnStart: false }))
        running = crawler.run([url])
        await running
        if (failure) throw failure
        if (!result) throw new Error("The page could not be scraped.")
        return result
      },
      catch: (cause) => cause instanceof ScrapeError ? cause : new ScrapeError({ message: cause instanceof Error ? cause.message : "Scraping failed." }),
    }).pipe(Effect.timeoutOrElse({ duration: TIMEOUT_MS, orElse: () => Effect.fail(new ScrapeError({ message: "Scraping timed out after 30 seconds." })) }))
  }),
)

export class Scraper extends Context.Service<Scraper, {
  readonly scrape: (input: { readonly url: string }) => Effect.Effect<ScrapeResult, ScrapeError>
}>()("@app/Scraper") {
  static readonly layer = Layer.succeed(Scraper, { scrape })
}
