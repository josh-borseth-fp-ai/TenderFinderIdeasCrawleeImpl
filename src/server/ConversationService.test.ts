import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Layer, Stream } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SourceStore } from "./onboarding/Store.ts"
import { OnboardingService } from "./onboarding/Service.ts"
import { conversationStream } from "./ConversationService.ts"
import { ConversationIntentModel } from "./ConversationIntentModel.ts"
import { ChatError, ChatService } from "./ChatService.ts"
import { SavedChatRequest, decodeChatEvent } from "../domain/Chat.ts"
import { SourceIntent } from "../domain/Conversation.ts"
import { Schema } from "effect"

let directory: string, service: OnboardingService, store: SourceStore, conversationId: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "saved-chat-")); store = new SourceStore(directory)
  service = new OnboardingService(store, { run: async () => { throw new Error("No runner expected") } }, async () => ({ action: "question", message: "Which region should I search?" }))
  globalThis.__onboardingService = service
  conversationId = store.createConversation().id
})
afterEach(async () => { globalThis.__onboardingService = undefined; await service.close(); store.close(); rmSync(directory, { recursive: true, force: true }) })
const run = (content: string, turnId: string, intent: SourceIntent = { action: "chat" }) => Effect.runPromise(Stream.runCollect(conversationStream({ conversationId, turnId, content })).pipe(Effect.provide(Layer.mergeAll(
  Layer.succeed(ConversationIntentModel, { decide: () => Effect.succeed(intent) }),
  Layer.succeed(ChatService, { stream: () => Stream.fromIterable([{ _tag: "TextDelta", delta: "Hello" }, { _tag: "Done" }]) }),
))))

describe("saved conversation orchestration", () => {
  it("persists ordinary chat and replays a repeated turn without duplicate messages", async () => {
    await run("Hello", "one"); await run("Hello", "one")
    const detail = store.conversationDetail(conversationId)
    expect(detail.messages.map((message) => message.content)).toEqual(["Hello", "Hello"])
    expect(detail.messages[1]?.status).toBe("complete")
    await expect(run("Different", "one")).rejects.toThrow("another message")
  })
  it("starts bare URLs immediately, links the source, and surfaces its question in the same conversation", async () => {
    const events = await run("https://example.com", "source")
    await service.idle()
    const detail = store.conversationDetail(conversationId)
    expect(detail.sources).toHaveLength(1)
    expect(detail.messages.some((message) => message.content === "Which region should I search?")).toBe(true)
    expect(events.some((event) => event._tag === "Message" && event.sourceIds.length === 1)).toBe(true)
    await run("https://example.com", "source")
    expect(service.list()).toHaveLength(1)
  })
  it("does not create sources for explicit URL reading or ambiguous corrections", async () => {
    await run("Read https://example.com", "read")
    await run("Change that source", "ambiguous", { action: "question", message: "Which source do you mean?" })
    expect(service.list()).toHaveLength(0)
    expect(store.conversationDetail(conversationId).messages.at(-1)?.content).toBe("Which source do you mean?")
  })
  it("supports multiple sources and rejects changes to a source outside the conversation", async () => {
    await run("https://example.com", "a"); await run("https://other.example.com", "b"); await service.idle()
    expect(store.conversationDetail(conversationId).sources).toHaveLength(2)
    const foreign = store.create({ name: "Foreign", seedUrls: ["https://foreign.example.com"], allowedDomains: ["foreign.example.com"], guidance: "", includePatterns: [], excludePatterns: [], requiredFields: ["title", "sourceUrl"], openOnly: true })
    const events = await run("Change foreign", "foreign", { action: "refine", sourceId: foreign.id, guidance: "Changed", openOnly: null })
    expect(events.some((event) => event._tag === "Error")).toBe(true)
    expect(store.source(foreign.id).revision).toBe(1)
  })
  it("retains a partial response on interruption and retries the original user turn", async () => {
    const request = { conversationId, turnId: "stop", content: "Hello" }
    await Effect.runPromise(conversationStream(request).pipe(Stream.take(2), Stream.runDrain, Effect.provide(Layer.mergeAll(
      Layer.succeed(ConversationIntentModel, { decide: () => Effect.succeed({ action: "chat" as const }) }),
      Layer.succeed(ChatService, { stream: () => Stream.succeed({ _tag: "TextDelta", delta: "Partial" }) }),
    ))))
    expect(store.conversationDetail(conversationId).messages.at(-1)?.status).toBe("interrupted")
    await run("Hello", "stop")
    expect(store.conversationDetail(conversationId).messages).toHaveLength(2)
    expect(store.conversationDetail(conversationId).messages.at(-1)?.status).toBe("complete")
  })
  it("saves provider errors and recovers streaming messages on restart", async () => {
    await Effect.runPromise(conversationStream({ conversationId, turnId: "fail", content: "Hi" }).pipe(Stream.runDrain, Effect.provide(Layer.mergeAll(
      Layer.succeed(ConversationIntentModel, { decide: () => Effect.fail(new ChatError({ message: "Provider unavailable" })) }),
      Layer.succeed(ChatService, { stream: () => Stream.empty }),
    ))))
    const last = store.conversationDetail(conversationId).messages.at(-1)!
    expect(last.status).toBe("error")
    store.saveChatMessage({ ...last, status: "streaming" }); store.recover()
    expect(store.chatMessage(last.id)?.status).toBe("interrupted")
  })
  it("validates saved-turn and streamed-reference boundaries", async () => {
    expect(() => Schema.decodeSync(SavedChatRequest)({ conversationId, turnId: "", content: "hi" })).toThrow()
    expect(() => Schema.decodeUnknownSync(SourceIntent)({ action: "approve", sourceId: "anything" })).toThrow()
    await expect(Effect.runPromise(decodeChatEvent('{"_tag":"Message","id":1,"sourceIds":[]}'))).rejects.toThrow()
  })
})
