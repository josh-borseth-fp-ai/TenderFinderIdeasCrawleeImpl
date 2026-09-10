import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import {
  ChatEvent,
  ChatRequest,
  decodeChatEvent,
  decodeChatRequest,
  encodeChatEvent,
  encodeChatRequest,
} from "./Chat.ts"

describe("ChatRequest", () => {
  it("round trips through JSON", () => {
    const request: ChatRequest = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    }
    const exit = decodeChatRequest(JSON.parse(JSON.stringify(encodeChatRequest(request))))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toEqual(request)
  })

  it("rejects malformed input", () => {
    expect(Exit.isFailure(decodeChatRequest({ messages: "nope" }))).toBe(true)
    expect(Exit.isFailure(decodeChatRequest({ messages: [{ role: "system", content: "x" }] }))).toBe(true)
  })
})

describe("ChatEvent", () => {
  const cases: ReadonlyArray<ChatEvent> = [
    { _tag: "TextDelta", delta: "Hel" },
    { _tag: "Done" },
    { _tag: "Error", message: "boom" },
  ]

  for (const event of cases) {
    it.effect(`round trips ${event._tag}`, () =>
      Effect.gen(function* () {
        const encoded = encodeChatEvent(event)
        expect(typeof encoded).toBe("string")
        const decoded = yield* decodeChatEvent(encoded)
        expect(decoded).toEqual(event)
      }),
    )
  }

  it.effect("fails on unknown tag", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(decodeChatEvent(JSON.stringify({ _tag: "Nope" })))
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it("is still a plain union schema", () => {
    expect(Schema.is(ChatEvent)({ _tag: "Done" })).toBe(true)
  })
})
