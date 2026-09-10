import { Effect } from "effect"
import { Scraper } from "../src/server/Scraper.ts"

const url = process.argv[2]
if (!url) {
  console.error("Usage: bun run scrape:example <url>")
  process.exit(1)
}
const program = Effect.gen(function* () {
  const scraper = yield* Scraper
  const result = yield* scraper.scrape({ url })
  console.log(JSON.stringify(result, null, 2))
}).pipe(Effect.provide(Scraper.layer))

await Effect.runPromise(program).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
