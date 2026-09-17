import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { SourceStore } from "./Store.ts"
import { OnboardingService, type Decide } from "./Service.ts"
import type { PackageRunner } from "./Runner.ts"
import { emptyBrief, type AgentDecision, type Job, type PackageDraft } from "../../domain/Source.ts"
import { recordsCsv } from "./Archive.ts"

const directories: string[] = [], stores: SourceStore[] = [], services: OnboardingService[] = []
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const draft: PackageDraft = { rationale: "Observed static HTML", runbook: "Collect open construction bids.", code: "export const extract = () => []; export const discover = () => []", tests: "fixture tests", routes: [{ label: "index", strategy: "cheerio", waitFor: null }] }
const inspect = { action: "inspect", url: "https://example.com/bids", strategy: "cheerio", reason: "Inspect listing" } as const satisfies AgentDecision
const evidence = { url: inspect.url, finalUrl: inspect.url, strategy: "cheerio" as const, label: "index", html: "<h1>Bridge repair</h1>", json: null, text: "Bridge repair", links: [] }
const live = { records: [{ title: "Bridge repair", sourceUrl: "https://example.com/bids/1", status: "open", evidence: "Bridge repair" }], evidence: [], errors: [], visitedCount: 1, coverage: "Fixture coverage" }
function setup(decisions: AgentDecision[] = [inspect, { action: "generate", package: draft }], runner?: PackageRunner) {
  const directory = mkdtempSync(join(tmpdir(), "source-tests-")); directories.push(directory)
  const store = new SourceStore(directory); stores.push(store)
  const source = store.create(emptyBrief("City procurement", inspect.url))
  const prompts: string[] = []
  const decide: Decide = async (prompt) => { prompts.push(prompt); const next = decisions.shift(); if (!next) throw new Error("No model decision"); return next }
  const calls: string[] = []
  const service = new OnboardingService(store, runner ?? { run: async (_files, _domains, options) => {
    calls.push(options.inspect ? "inspect" : options.test ? "test" : "live")
    return options.inspect ? { ...live, records: [], evidence: [evidence] } : live
  } }, decide)
  services.push(service)
  return { service, store, source, calls, prompts, directory }
}
describe("source lifecycle", () => {
  it("investigates, validates, approves an exact version, and manually executes it", async () => {
    const { service, source, store, calls } = setup()
    await service.command({ action: "generate", sourceId: source.id }); await service.idle()
    const detail = service.detail(source.id), version = detail.versions[0]!
    expect(detail.jobs[0]?.state).toBe("succeeded")
    expect(version.report?.passed).toBe(true)
    expect(calls).toEqual(["inspect", "test", "live"])
    expect(store.source(source.id).approvedVersionId).toBeNull()
    await service.command({ action: "approve", sourceId: source.id, versionId: version.id, revision: source.revision, digest: version.digest })
    expect(store.source(source.id).approvedVersionId).toBe(version.id)
    await service.command({ action: "run", sourceId: source.id }); await service.idle()
    const run = service.detail(source.id).jobs[0]!
    expect(run.state).toBe("succeeded"); expect(run.versionId).toBe(version.id)
    expect(JSON.parse(store.readArtifact(run.id, "results.json"))[0].title).toBe("Bridge repair")
    expect(service.files(version)["SCRAPER.md"]).toContain("No Browserbase")
  })
  it("rejects stale approvals while retaining the previous approved version", async () => {
    const { service, source, store } = setup()
    await service.command({ action: "generate", sourceId: source.id }); await service.idle()
    const version = service.detail(source.id).versions[0]!
    const approval = { action: "approve" as const, sourceId: source.id, versionId: version.id, revision: source.revision, digest: version.digest }
    await service.command(approval)
    await service.command({ action: "update", sourceId: source.id, revision: 1, brief: { ...source.brief, guidance: "Exclude roofing" } })
    await expect(service.command(approval)).rejects.toThrow("Stale approval")
    expect(store.source(source.id).approvedVersionId).toBe(version.id)
    await service.command({ action: "run", sourceId: source.id }); await service.idle()
    expect(service.detail(source.id).jobs[0]?.state).toBe("succeeded")
  })
  it("retains evidence and passes observed validation failures into a bounded repair", async () => {
    let liveCalls = 0
    const { service, source, prompts } = setup([inspect, { action: "generate", package: draft }, { action: "generate", package: { ...draft, code: `${draft.code}\n// repaired` } }], {
      run: async (_files, _domains, options) => options.inspect ? { ...live, records: [], evidence: [evidence] } : options.test ? live : ++liveCalls === 1 ? { ...live, records: [] } : live,
    })
    await service.command({ action: "generate", sourceId: source.id }); await service.idle()
    const versions = service.detail(source.id).versions
    expect(versions).toHaveLength(2)
    expect(versions[0]?.report?.passed).toBe(true)
    expect(versions[1]?.report?.passed).toBe(false)
    expect(prompts[2]).toContain("No valid matching live records")
    expect(prompts[2]).toContain("Bridge repair")
  })
  it("asks for missing intent without creating or approving a package", async () => {
    const { service, source } = setup([{ action: "question", message: "Which purchasing region should be included?" }])
    await service.command({ action: "generate", sourceId: source.id }); await service.idle()
    const detail = service.detail(source.id)
    expect(detail.jobs[0]?.state).toBe("needs-input")
    expect(detail.versions).toHaveLength(0)
    expect(detail.messages[0]?.content).toContain("region")
  })
  it("rejects package tampering before approval", async () => {
    const { service, store, source } = setup()
    await service.command({ action: "generate", sourceId: source.id }); await service.idle()
    const version = service.detail(source.id).versions[0]!
    const files = { ...service.files(version), "scraper.ts": "tampered" }
    store.writeArtifact(version.id, "package.json", JSON.stringify(files))
    await expect(service.command({ action: "approve", sourceId: source.id, versionId: version.id, revision: 1, digest: version.digest })).rejects.toThrow("integrity")
  })
  it("invalidates a formerly passing report when revalidation fails", async () => {
    let failTests = false
    const { service, source } = setup(undefined, { run: async (_files, _domains, options) => {
      if (options.inspect) return { ...live, records: [], evidence: [evidence] }
      if (options.test && failTests) throw new Error("Changed fixture expectation")
      return live
    } })
    await service.command({ action: "generate", sourceId: source.id }); await service.idle()
    const version = service.detail(source.id).versions[0]!
    expect(version.report?.passed).toBe(true)
    failTests = true
    await service.command({ action: "validate", sourceId: source.id, versionId: version.id }); await service.idle()
    expect(service.detail(source.id).versions[0]?.report?.passed).toBe(false)
    await expect(service.command({ action: "approve", sourceId: source.id, versionId: version.id, revision: 1, digest: version.digest })).rejects.toThrow("Approval requires")
  })
  it("preserves checkpoints when a manual run is interrupted", async () => {
    let interrupt = false
    const { service, source, store } = setup(undefined, { run: async (_files, _domains, options) => {
      if (options.inspect) return { ...live, records: [], evidence: [evidence] }
      if (interrupt) { options.onProgress?.(live); throw new Error("Worker interrupted") }
      return live
    } })
    await service.command({ action: "generate", sourceId: source.id }); await service.idle()
    const version = service.detail(source.id).versions[0]!
    await service.command({ action: "approve", sourceId: source.id, versionId: version.id, revision: 1, digest: version.digest })
    interrupt = true
    await service.command({ action: "run", sourceId: source.id }); await service.idle()
    const job = service.detail(source.id).jobs[0]!
    expect(job.state).toBe("failed")
    expect(job.report?.passed).toBe(false)
    expect(job.report?.errors.join(" ")).toContain("partial")
    expect(JSON.parse(store.readArtifact(job.id, "results.json"))).toHaveLength(1)
  })
  it("cancels active work without presenting it as a successful run", async () => {
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const { service, source } = setup([inspect], { run: async (_files, _domains, options) => {
      started()
      return new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }) })
    } })
    const job = await service.command({ action: "generate", sourceId: source.id }) as Job
    await ready
    await service.command({ action: "cancel", jobId: job.id }); await service.idle()
    expect(service.detail(source.id).jobs[0]?.state).toBe("cancelled")
  })
  it("cancels queued work without executing it or stalling the queue", async () => {
    let ready!: () => void
    const started = new Promise<void>((resolve) => { ready = resolve })
    const { service, source, store } = setup([inspect], { run: async (_files, _domains, options) => {
      ready()
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))
    } })
    const first = await service.command({ action: "generate", sourceId: source.id }) as Job
    await started
    const secondSource = store.create(emptyBrief("Second source", inspect.url))
    const second = await service.command({ action: "generate", sourceId: secondSource.id }) as Job
    expect(store.job(second.id).state).toBe("queued")
    await service.command({ action: "cancel", jobId: second.id })
    await service.command({ action: "cancel", jobId: first.id })
    await service.idle()
    expect(store.job(second.id).state).toBe("cancelled")
    expect(service.detail(secondSource.id).versions).toHaveLength(0)
  })
  it("recovers unfinished jobs after a restart and keeps saved sources", () => {
    const { store, source } = setup()
    const id = randomUUID()
    store.saveJob({ id, sourceId: source.id, kind: "generate", versionId: null, revision: 1, state: "running", message: "working", createdAt: "now", updatedAt: "now", report: null })
    store.recover()
    expect(store.job(id).state).toBe("interrupted")
    expect(store.source(source.id).brief.name).toBe("City procurement")
    expect(store.events(source.id, 0)[0]?.message).toContain("restarted")
  })
  it("neutralizes formula injection in exported CSV", () => {
    expect(recordsCsv([{ title: "=SUM(A1)", buyer: 'a "quoted" buyer' }])).toContain('"\'=SUM(A1)"')
    expect(recordsCsv([{ buyer: 'a "quoted" buyer' }])).toContain('"a ""quoted"" buyer"')
  })
})
