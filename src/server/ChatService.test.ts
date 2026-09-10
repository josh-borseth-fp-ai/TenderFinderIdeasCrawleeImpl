import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { AiError, LanguageModel, type Response } from "effect/unstable/ai"
import { ChatError, ChatService } from "./ChatService.ts"
import { Scraper } from "./Scraper.ts"
import { ScrapeError } from "../domain/Scrape.ts"

const unusedScraper = Layer.succeed(Scraper, { scrape: () => Effect.die("Unexpected scrape") })

const parts: ReadonlyArray<Response.StreamPartEncoded> = [
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Hel" },
  { type: "text-delta", id: "t1", delta: "lo" },
  { type: "text-end", id: "t1" },
  {
    type: "finish",
    reason: "stop",
    usage: {
      inputTokens: { uncached: 3, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { text: 2, reasoning: undefined },
    },
  },
]

const fakeModel = (streamText: Parameters<typeof LanguageModel.make>[0]["streamText"]) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => Effect.succeed([]),
      streamText,
    }),
  )

const happyLayer = ChatService.layer.pipe(Layer.provide(fakeModel(() => Stream.fromIterable(parts))), Layer.provide(unusedScraper))

const aiError = AiError.make({
  module: "Test",
  method: "streamText",
  reason: new AiError.AuthenticationError({ kind: "InvalidKey", description: "bad key" }),
})
const failingLayer = ChatService.layer.pipe(Layer.provide(fakeModel(() => Stream.fail(aiError))), Layer.provide(unusedScraper))

describe("ChatService", () => {
  for (const fail of [false, true]) {
    it.effect(`passes ${fail ? "scrape failure" : "scraped content"} into the answering call and limits execution`, () => {
      let calls = 0
      let executions = 0
      const result = { url: "https://example.com/", finalUrl: "https://example.com/", title: "Example", text: "Scraped evidence", truncated: false }
      const model = fakeModel((options) => {
        calls++
        if (calls === 1) return Stream.fromIterable([
          { type: "tool-call", id: "call-1", name: "scrapeUrl", params: { url: result.url } },
          { type: "tool-call", id: "call-2", name: "scrapeUrl", params: { url: result.url } },
          { ...parts.at(-1)!, type: "finish", reason: "tool-calls" },
        ] as Array<Response.StreamPartEncoded>)
        expect(options.toolChoice).toBe("none")
        const history = JSON.stringify(options.prompt)
        expect(history).toContain(fail ? "Fixture scrape failure" : "Scraped evidence")
        expect(history).toContain("Only one scrape")
        return Stream.fromIterable(parts)
      })
      const scraper = Layer.succeed(Scraper, { scrape: () => {
        executions++
        return fail ? Effect.fail(new ScrapeError({ message: "Fixture scrape failure" })) : Effect.succeed(result)
      } })
      return Effect.gen(function* () {
        const chat = yield* ChatService
        const events = yield* Stream.runCollect(chat.stream([{ role: "user", content: "Scrape https://example.com" }]))
        expect(calls).toBe(2)
        expect(executions).toBe(1)
        expect(events).toEqual([{ _tag: "TextDelta", delta: "Hel" }, { _tag: "TextDelta", delta: "lo" }, { _tag: "Done" }])
      }).pipe(Effect.provide(ChatService.layer.pipe(Layer.provide(model), Layer.provide(scraper))))
    })
  }
  it.effect("maps text deltas to TextDelta events and appends Done", () =>
    Effect.gen(function* () {
      const chat = yield* ChatService
      const events = yield* Stream.runCollect(chat.stream([{ role: "user", content: "hi" }]))
      expect(events).toEqual([
        { _tag: "TextDelta", delta: "Hel" },
        { _tag: "TextDelta", delta: "lo" },
        { _tag: "Done" },
      ])
    }).pipe(Effect.provide(happyLayer)),
  )

  it.effect("maps provider failures to ChatError", () =>
    Effect.gen(function* () {
      const chat = yield* ChatService
      const error = yield* Stream.runCollect(chat.stream([{ role: "user", content: "hi" }])).pipe(Effect.flip)
      expect(error).toBeInstanceOf(ChatError)
      expect(error.message).toContain("bad key")
    }).pipe(Effect.provide(failingLayer)),
  )
  it.effect("treats an encoded provider error as terminal", () =>
    Effect.gen(function* () {
      const chat = yield* ChatService
      const events = yield* Stream.runCollect(chat.stream([{ role: "user", content: "hi" }]))
      expect(events).toEqual([{ _tag: "Error", message: "Provider stream failed" }])
    }).pipe(Effect.provide(ChatService.layer.pipe(
      Layer.provide(fakeModel(() => Stream.fromIterable([{ type: "error", error: "Provider stream failed" }]))),
      Layer.provide(unusedScraper),
    ))),
  )
})
