import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SourceStore } from "./Store.ts"
import { OnboardingService } from "./Service.ts"
import type { AgentDecision, PackageDraft } from "../../domain/Source.ts"
import { emptyBrief } from "../../domain/Source.ts"
import { validateRecords } from "./Records.ts"
import { sourceApi } from "./Http.ts"
import type { PackageRunner } from "./Runner.ts"

const dirs: string[] = [], stores: SourceStore[] = [], services: OnboardingService[] = []
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); globalThis.__onboardingService = undefined })
const draft: PackageDraft = { rationale: "Observed bids", runbook: "Bids", code: "export const extract = () => []; export const discover = () => []", tests: "fixture", routes: [{ label: "index", strategy: "http", waitFor: null }] }
const evidence = { url: "https://example.com", finalUrl: "https://example.com", strategy: "http" as const, label: "index", html: null, json: {}, text: "Bid", links: ["https://api.example.com/bids"] }
const bid = (n: number) => ({ title: `Bid ${n}`, sourceUrl: `https://example.com/bid/${n}`, status: "open", evidence: `Bid ${n}` })
function setup(options: { collection?: PackageRunner["run"]; validation?: PackageRunner["run"]; decisions?: AgentDecision[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "collections-")); dirs.push(dir)
  const store = new SourceStore(dir); stores.push(store)
  const conversation = store.createConversation()
  let batches = 0
  const calls: string[] = []
  const decisions: AgentDecision[] = options.decisions ?? [{ action: "inspect", url: "https://example.com", strategy: "http", reason: "Read index" }, { action: "generate", package: draft }]
  const service = new OnboardingService(store, { run: async (files, domains, input) => {
    if (input.collectionDirectory) {
      calls.push("collect")
      if (options.collection) return options.collection(files, domains, input)
      input.onRecords?.(Array.from({ length: 51 }, (_, i) => bid(i + batches * 50)))
      const complete = ++batches % 2 === 0
      return { records: [], evidence: [], errors: [], visitedCount: 2, coverage: complete ? "Complete" : "More pages", collection: { complete, pending: complete ? 0 : 1, processed: 2, expectedCount: 101, issues: [] } }
    }
    calls.push(input.inspect ? "inspect" : input.test ? "test" : "validate")
    if (!input.inspect && !input.test && options.validation) return options.validation(files, domains, input)
    return { records: input.inspect ? [] : [bid(0)], evidence: input.inspect ? [evidence] : [], errors: [], visitedCount: 1, coverage: "Internal validation" }
  } }, async () => { const next = decisions.shift(); if (!next) throw new Error("Unexpected model call"); return next })
  services.push(service)
  return { dir, store, service, conversation, calls }
}

describe("full opportunity collections", () => {
  it("collects and saves an explicitly verified empty source without mistaking an extraction failure for emptiness", async () => {
    const { store, service, conversation } = setup({
      validation: async () => ({ records: [], evidence: [], errors: [], visitedCount: 1, coverage: "All requests processed", expectedCount: 0 }),
      collection: async () => ({ records: [], evidence: [], errors: [], visitedCount: 1, coverage: "All requests processed", collection: { complete: true, pending: 0, processed: 1, expectedCount: 0, issues: [] } }),
    })
    const source = service.discover(conversation.id, "empty", "https://example.com", ""); await service.idle()
    const collection = store.latestCollection(source.id)!
    expect(collection.state).toBe("complete"); expect(collection.count).toBe(0)
    expect(store.resultPage(collection.id).records).toEqual([])
    await service.conversationAction({ requestId: "save-empty", conversationId: conversation.id, sourceId: source.id, collectionId: collection.id, action: "save" })
    expect(store.source(source.id).approvedVersionId).toBe(collection.versionId)
    const unverified = setup({ validation: async () => ({ records: [], evidence: [], errors: [], visitedCount: 1, coverage: "All requests processed" }) })
    const missing = unverified.service.discover(unverified.conversation.id, "unverified", "https://example.com", ""); await unverified.service.idle()
    expect(unverified.store.latestCollection(missing.id)).toBeNull()
    expect(unverified.store.source(missing.id).approvedVersionId).toBeNull()
  })
  it("pauses a traversal that repeats work without adding records or reducing remaining requests", async () => {
    let batches = 0
    const { store, service, conversation } = setup({ collection: async (_files, _domains, input) => {
      if (++batches === 1) input.onRecords?.([bid(1)])
      return { records: [], evidence: [], errors: [], visitedCount: 1, coverage: "More pages", collection: { complete: false, pending: 2, processed: 1, expectedCount: null, issues: [] } }
    } })
    const source = service.discover(conversation.id, "stalled", "https://example.com", ""); await service.idle()
    expect(batches).toBe(4)
    expect(store.latestCollection(source.id)).toMatchObject({ state: "partial", count: 1, coverage: expect.stringContaining("stopped making progress") })
  })
  it("collects before confirmation, deduplicates across batches, pages all records, and confirms without rerunning", async () => {
    const { store, service, conversation, calls } = setup()
    const source = service.discover(conversation.id, "turn-1", "https://example.com", "")
    expect(service.discover(conversation.id, "turn-1", "https://example.com", "").id).toBe(source.id)
    await service.idle()
    const collection = store.latestCollection(source.id)!
    expect(collection.state).toBe("complete"); expect(collection.count).toBe(101)
    expect(store.source(source.id).approvedVersionId).toBeNull()
    expect([1, 2, 3].map((page) => store.resultPage(collection.id, page).records.length)).toEqual([50, 50, 1])
    expect(new Set([1, 2, 3].flatMap((page) => store.resultPage(collection.id, page).records.map((record) => record.id))).size).toBe(101)
    const action = { requestId: "confirm", conversationId: conversation.id, sourceId: source.id, collectionId: collection.id, action: "save" as const }
    await service.conversationAction(action); await service.conversationAction(action)
    expect(store.source(source.id).approvedVersionId).toBe(collection.versionId)
    expect(calls).toEqual(["inspect", "test", "validate", "collect", "collect"])
    expect(store.conversationDetail(conversation.id).messages.some((message) => message.content.includes("101 opportunities"))).toBe(true)
    await expect(service.conversationAction({ ...action, action: "refresh" })).rejects.toThrow("different action")
  })
  it("keeps refresh snapshots separate and starts only one job for a repeated action", async () => {
    const { store, service, conversation } = setup()
    const source = service.discover(conversation.id, "start", "https://example.com", ""); await service.idle()
    const original = store.latestCollection(source.id)!
    await service.conversationAction({ requestId: "save", conversationId: conversation.id, sourceId: source.id, collectionId: original.id, action: "save" })
    const refresh = { requestId: "refresh", conversationId: conversation.id, sourceId: source.id, collectionId: original.id, action: "refresh" as const }
    await service.conversationAction(refresh); await service.conversationAction(refresh); await service.idle()
    const latest = store.latestCollection(source.id)!
    expect(latest.id).not.toBe(original.id)
    expect(latest.count).toBe(101); expect(latest.state).toBe("complete")
    expect(store.resultPage(original.id).records.some((record) => record.title === "Bid 0")).toBe(true)
    expect(store.resultPage(latest.id).records.some((record) => record.title === "Bid 0")).toBe(false)
    expect(service.detail(source.id).jobs).toHaveLength(2)
  })
  it("lets the agent configure observed hosts and keeps source, job, and package revisions aligned", async () => {
    const { store, service, conversation } = setup({ decisions: [
      { action: "inspect", url: "https://example.com", strategy: "http", reason: "Find feed" },
      { action: "configure", name: "City opportunities", seedUrls: ["https://api.example.com/bids"], allowedDomains: ["api.example.com"] },
      { action: "generate", package: draft },
    ] })
    const source = service.discover(conversation.id, "start", "https://example.com", ""); await service.idle()
    const detail = service.detail(source.id)
    expect(detail.source.brief.allowedDomains).toEqual(["example.com", "api.example.com"])
    expect(detail.source.brief.name).toBe("City opportunities")
    expect(detail.source.revision).toBe(2)
    expect(detail.versions[0]?.revision).toBe(2)
    expect(detail.jobs[0]?.revision).toBe(2)
    expect(store.latestCollection(source.id)?.state).toBe("complete")
  })
  it("retains partial records after failure and resumes the same collection", async () => {
    let attempts = 0
    const { store, service, conversation } = setup({ collection: async (_files, _domains, input) => {
      input.onRecords?.([bid(attempts)])
      if (++attempts === 1) throw new Error("Connection lost")
      return { records: [], evidence: [], errors: [], visitedCount: 1, coverage: "Complete", collection: { complete: true, pending: 0, processed: 1, expectedCount: 2, issues: [] } }
    } })
    const source = service.discover(conversation.id, "start", "https://example.com", "")
    await service.idle()
    const collection = store.latestCollection(source.id)!
    expect(collection.state).toBe("partial"); expect(collection.count).toBe(1)
    await expect(service.conversationAction({ requestId: "save-partial", conversationId: conversation.id, sourceId: source.id, collectionId: collection.id, action: "save" })).rejects.toThrow("complete")
    await service.conversationAction({ requestId: "resume", conversationId: conversation.id, sourceId: source.id, action: "continue" }); await service.idle()
    expect(store.latestCollection(source.id)?.id).toBe(collection.id)
    expect(store.collection(collection.id).count).toBe(2); expect(store.collection(collection.id).state).toBe("complete")
  })
  it("does not confirm stale collections or silently accept missing records", async () => {
    const { store, service, conversation } = setup({ collection: async (_files, _domains, input) => {
      input.onRecords?.([bid(1)])
      return { records: [], evidence: [], errors: [], visitedCount: 1, coverage: "Complete", collection: { complete: true, pending: 0, processed: 1, expectedCount: 2, issues: [] } }
    } })
    const source = service.discover(conversation.id, "start", "https://example.com", "")
    await service.idle()
    const collection = store.latestCollection(source.id)!
    expect(collection.state).toBe("partial"); expect(collection.coverage).toContain("source reports 2")
    store.saveCollection({ ...collection, state: "complete" })
    store.update(source.id, store.source(source.id).revision, { ...source.brief, guidance: "changed" })
    await expect(service.conversationAction({ requestId: "save-stale", conversationId: conversation.id, sourceId: source.id, collectionId: collection.id, action: "save" })).rejects.toThrow("Stale")
  })
  it("exports the complete collection including later pages with one CSV header", async () => {
    const { store, service, conversation } = setup()
    globalThis.__onboardingService = service
    const source = service.discover(conversation.id, "start", "https://example.com", ""); await service.idle()
    const collection = store.latestCollection(source.id)!
    const response = await sourceApi(new Request(`http://localhost/api/sources?collectionId=${collection.id}`))
    expect(response.status).toBe(200)
    const csv = await response.text()
    expect(csv).toContain('"Bid 100"'); expect(csv.trim().split("\n")).toHaveLength(102)
  })
  it("rejects malformed pages, private URLs and conflicting request IDs", () => {
    const { service, conversation, store } = setup()
    expect(() => service.discover(conversation.id, "private", "http://127.0.0.1", "")).toThrow()
    const source = service.discover(conversation.id, "start", "https://example.com", "")
    expect(() => service.discover(conversation.id, "start", "https://other.example.com", "")).toThrow("different action")
    expect(() => store.resultPage(source.id, 0)).toThrow("Invalid page")
  })
  it("migrates legacy conversations and preserves partial legacy coverage", async () => {
    const { service, store, dir } = setup()
    const source = store.create(emptyBrief("Legacy", "https://example.com"))
    store.message(source.id, "user", "Find bids")
    const id = crypto.randomUUID(), versionId = crypto.randomUUID()
    store.saveJob({ id, sourceId: source.id, versionId, kind: "run", revision: 1, state: "succeeded", message: "Bounded", report: null, createdAt: "then", updatedAt: "then" })
    store.saveResults(id, validateRecords([bid(0)], source.id, source.brief, { testsPassed: true, visitedCount: 1, errors: [], coverage: "Bounded", requireNonempty: false }).records)
    await service.close(); services.splice(services.indexOf(service), 1); store.close(); stores.splice(stores.indexOf(store), 1)
    const reopened = new SourceStore(dir); stores.push(reopened)
    expect(reopened.conversationDetail(`source-${source.id}`).messages[0]?.content).toBe("Find bids")
    expect(reopened.collection(id).state).toBe("partial")
    expect(reopened.collection(id).count).toBe(1)
    reopened.close(); stores.splice(stores.indexOf(reopened), 1)
    const twice = new SourceStore(dir); stores.push(twice)
    expect(twice.conversationDetail(`source-${source.id}`).messages).toHaveLength(1)
  })
})
