import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { AiError, LanguageModel, type Response } from "effect/unstable/ai"
import { ChatError, ChatService } from "./ChatService.ts"

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

const fakeModel = (streamText: () => Stream.Stream<Response.StreamPartEncoded, AiError.AiError>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => Effect.succeed([]),
      streamText,
    }),
  )

const happyLayer = ChatService.layer.pipe(Layer.provide(fakeModel(() => Stream.fromIterable(parts))))

const aiError = AiError.make({
  module: "Test",
  method: "streamText",
  reason: new AiError.AuthenticationError({ kind: "InvalidKey", description: "bad key" }),
})
const failingLayer = ChatService.layer.pipe(Layer.provide(fakeModel(() => Stream.fail(aiError))))

describe("ChatService", () => {
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
})
