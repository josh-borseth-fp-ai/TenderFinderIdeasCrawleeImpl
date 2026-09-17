import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SourceApi } from "../../domain/SourceApi.ts"
import { emptyBrief } from "../../domain/Source.ts"
import { sourceDataApi } from "./Api.ts"
import { sourceEvents } from "./Http.ts"
import { SourceStore } from "./Store.ts"
import { OnboardingService } from "./Service.ts"

let root: string, service: OnboardingService
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "source-api-"))
  service = new OnboardingService(new SourceStore(root), { run: async () => { throw new Error("Not used") } }, async () => ({ action: "question", message: "Which region?" }))
  globalThis.__onboardingService = service
})
afterEach(async () => { globalThis.__onboardingService = undefined; await service.close(); service.store.close(); rmSync(root, { recursive: true, force: true }) })

const request = (command: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/source-data/command", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ command }),
})

describe("typed source API", () => {
  it("round-trips commands, queries and typed failures through the generated client", async () => {
    const program = Effect.gen(function* () {
      const client = yield* HttpApiClient.make(SourceApi, { baseUrl: "http://localhost" })
      const created = yield* client.sources.command({ payload: { command: { action: "create", brief: emptyBrief("Procurement", "https://example.com/bids") } } })
      expect("source" in created).toBe(true)
      if (!("source" in created)) throw new Error("Expected source detail")
      const list = yield* client.sources.list()
      expect(list[0]?.id).toBe(created.source.id)
      const detail = yield* client.sources.detail({ params: { id: created.source.id } })
      expect(detail.source.brief.name).toBe("Procurement")
      const failure = yield* client.sources.detail({ params: { id: "missing" } }).pipe(Effect.flip)
      expect(failure._tag).toBe("SourceError")
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, Object.assign((input: RequestInfo | URL, init?: RequestInit) => sourceDataApi(new Request(input, init)), { preconnect: () => {} })),
    )
    await Effect.runPromise(program)
  })
  it("rejects invalid commands and cross-origin mutations", async () => {
    expect((await sourceDataApi(request({ action: "invented" }))).status).toBe(400)
    expect((await sourceDataApi(request({ action: "create", brief: emptyBrief() }, { origin: "https://elsewhere.example" }))).status).toBe(403)
    expect(service.list()).toHaveLength(0)
  })
  it("round-trips saved conversations and rejects invalid conversation mutations and pages", async () => {
    const post = (path: string, body: unknown, origin = "http://localhost") => sourceDataApi(new Request(`http://localhost/api/source-data/${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }))
    expect((await post("conversations", { id: "chat" })).status).toBe(200)
    expect((await post("conversations", { id: "" })).status).toBe(400)
    expect((await post("conversations", { id: "foreign" }, "https://elsewhere.example")).status).toBe(403)
    expect((await sourceDataApi(new Request("http://localhost/api/source-data/conversation/chat"))).status).toBe(200)
    expect((await post("conversation-action", { requestId: "one", conversationId: "chat", sourceId: "missing", action: "invented" })).status).toBe(400)
    expect((await sourceDataApi(new Request("http://localhost/api/source-data/results/missing?page=NaN"))).status).toBe(400)
    expect(service.store.conversations().map((conversation) => conversation.id)).toEqual(["chat"])
  })
  it("replays progress after Last-Event-ID and closes the stream on cancellation", async () => {
    const source = service.store.create(emptyBrief("Procurement", "https://example.com"))
    const job = await service.command({ action: "generate", sourceId: source.id })
    if (!("state" in job)) throw new Error("Expected job")
    await service.idle()
    const events = service.store.events(source.id, 0)
    const after = events[0]!.id
    const controller = new AbortController()
    const response = await sourceEvents(new Request(`http://localhost/api/source-events?sourceId=${source.id}`, { headers: { "last-event-id": String(after) }, signal: controller.signal }))
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let output = ""
    while (!output.includes(`id: ${events.at(-1)!.id}\n`)) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error("Stream closed before replay")
      output += decoder.decode(chunk.value)
    }
    expect(output).not.toContain(`id: ${after}\n`)
    expect(output).toContain("Which region?")
    controller.abort()
    while (!(await reader.read()).done) { /* Drain any buffered events. */ }
  })
})
