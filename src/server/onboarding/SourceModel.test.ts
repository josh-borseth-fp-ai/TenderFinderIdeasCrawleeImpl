import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { SourceModel } from "./SourceModel.ts"

const layer = (text: string) => SourceModel.layer.pipe(Layer.provide(Layer.effect(LanguageModel.LanguageModel, LanguageModel.make({
  generateText: (options) => {
    expect(JSON.stringify(options.prompt)).toContain("UNTRUSTED DATA")
    expect(options.responseFormat.type).toBe("json")
    return Effect.succeed([{ type: "text", text: JSON.stringify({ decision: JSON.parse(text) }) }])
  },
  streamText: () => Stream.empty,
}))))
describe("source model boundary", () => {
  it.effect("decodes a structured decision", () => Effect.gen(function* () {
    const model = yield* SourceModel
    const result = yield* model.decide("source brief")
    expect(result).toEqual({ action: "question", message: "Which region?" })
  }).pipe(Effect.provide(layer('{"action":"question","message":"Which region?"}'))))
  it.effect("rejects invented tool actions through the typed error channel", () => Effect.gen(function* () {
    const model = yield* SourceModel
    const error = yield* model.decide("source brief").pipe(Effect.flip)
    expect(error._tag).toBe("SourceError")
  }).pipe(Effect.provide(layer('{"action":"approve","version":"anything"}'))))
  it.effect("rejects incomplete generated packages during structured decoding", () => Effect.gen(function* () {
    const model = yield* SourceModel
    const error = yield* model.decide("source brief").pipe(Effect.flip)
    expect(error.kind).toBe("invalid-output")
  }).pipe(Effect.provide(layer(JSON.stringify({
    action: "generate",
    package: { rationale: "Static HTML", runbook: "Instructions", code: " ", tests: "tests", routes: [{ label: "index", strategy: "cheerio", waitFor: null }] },
  })))))

})
