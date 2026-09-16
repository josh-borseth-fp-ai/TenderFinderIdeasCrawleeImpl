import { randomUUID } from "node:crypto"
import { Deferred, Effect, Fiber, Queue, Schema } from "effect"
import { AgentDecision, SourceError, Evidence, type Job, type PackageDraft, type ScraperVersion, type SourceCommand, type SourceDetail } from "../../domain/Source.ts"
import { SourceStore, digestFiles } from "./Store.ts"
import { permittedUrl, validateBrief, validateRecords } from "./Records.ts"
import { Manifest, PackageFiles } from "../../../runner/contract.ts"
import { manifest, packageFiles, runtimeFile } from "./Packages.ts"
import type { PackageRunner } from "./Runner.ts"

export type Decide = (prompt: string, signal: AbortSignal) => Promise<AgentDecision>
const now = () => new Date().toISOString()
const describe = (error: unknown) => error instanceof Error ? error.message : String(error)

export class OnboardingService {
  private readonly queue = Effect.runSync(Queue.unbounded<Effect.Effect<void>>())
  private readonly worker: Fiber.Fiber<never>
  private active: { id: string; fiber: Fiber.Fiber<void> } | null = null
  constructor(readonly store: SourceStore, private readonly runner: PackageRunner, private readonly decide: Decide) {
    store.recover()
    this.worker = Effect.runFork(Queue.take(this.queue).pipe(Effect.flatMap((work) => work), Effect.forever))
  }
  async close() { await Effect.runPromise(Fiber.interrupt(this.worker)) }
  list() { return this.store.list() }
  detail(id: string) { return this.store.detail(id) }
  async command(command: SourceCommand): Promise<SourceDetail | Job> {
    if (command.action === "cancel") {
      const job = this.store.job(command.jobId)
      if (!["queued", "running"].includes(job.state)) return job
      this.store.event({ ...job, state: "cancelled" }, "Cancelled by operator. Partial results are not a completed run.")
      if (this.active?.id === job.id) await Effect.runPromise(Fiber.interrupt(this.active.fiber))
      return this.store.job(job.id)
    }
    if (command.action === "create") return this.detail(this.store.create(validateBrief(command.brief)).id)
    const source = this.store.source(command.sourceId)
    switch (command.action) {
      case "update":
        this.store.update(source.id, command.revision, validateBrief(command.brief))
        return this.detail(source.id)
      case "message": {
        const content = command.content.trim()
        if (!content || content.length > 10_000) throw new Error("Message must contain 1–10,000 characters")
        if (this.store.detail(source.id).jobs.some((job) => ["queued", "running"].includes(job.state))) throw new Error("Stop the active job before adding guidance.")
        this.store.transaction(() => {
          const guidance = `${source.brief.guidance}\n\nUser guidance: ${content}`.trim()
          validateBrief({ ...source.brief, guidance })
          this.store.saveSource({ ...source, brief: { ...source.brief, guidance }, revision: source.revision + 1, updatedAt: now() })
          this.store.message(source.id, "user", content)
        })
        return this.enqueue(source.id, "generate", null)
      }
      case "generate": return this.enqueue(source.id, "generate", null)
      case "validate": {
        const version = this.ownedVersion(source.id, command.versionId)
        if (version.approvedAt) throw new Error("Approved versions are immutable. Generate a new candidate to revalidate changes.")
        if (version.revision !== source.revision) throw new Error("Source guidance has changed. Generate a new candidate.")
        return this.enqueue(source.id, "validate", version.id)
      }
      case "approve":
        this.store.transaction(() => {
          const current = this.store.source(source.id), version = this.ownedVersion(source.id, command.versionId)
          if (current.revision !== command.revision || version.revision !== command.revision || version.digest !== command.digest) throw new Error("Stale approval. Refresh and validate the current source revision.")
          this.files(version)
          if (!version.report?.passed || !version.report.testsPassed || !version.samples.length) throw new Error("Approval requires passing fixture tests and a nonempty valid live sample.")
          if (this.store.detail(source.id).jobs.some((job) => ["queued", "running"].includes(job.state))) throw new Error("Wait for validation to finish before approving.")
          this.store.saveVersion({ ...version, approvedAt: version.approvedAt ?? now() })
          this.store.saveSource({ ...current, approvedVersionId: version.id, updatedAt: now() })
        })
        return this.detail(source.id)
      case "run": {
        if (!source.approvedVersionId) throw new Error("Approve a validated version first.")
        const version = this.ownedVersion(source.id, source.approvedVersionId)
        if (!version.approvedAt) throw new Error("Version is not approved")
        this.files(version)
        return this.enqueue(source.id, "run", version.id)
      }
    }
  }
  private ownedVersion(sourceId: string, id: string) {
    const version = this.store.version(id)
    if (version.sourceId !== sourceId) throw new Error("Version does not belong to this source")
    return version
  }
  files(version: ScraperVersion): PackageFiles {
    const files = Schema.decodeSync(Schema.fromJsonString(PackageFiles))(this.store.readArtifact(version.id, "package.json"))
    if (digestFiles(files) !== version.digest) throw new Error("Package integrity check failed")
    return files
  }
  private enqueue(sourceId: string, kind: Job["kind"], versionId: string | null) {
    const source = this.store.source(sourceId)
    if (this.detail(sourceId).jobs.some((job) => ["queued", "running"].includes(job.state))) throw new Error("This source already has an active job")
    const job: Job = { id: randomUUID(), sourceId, kind, versionId, revision: source.revision, state: "queued", message: "Queued", createdAt: now(), updatedAt: now(), report: null }
    this.store.saveJob(job); this.store.event(job, "Queued")
    Effect.runSync(Queue.offer(this.queue, Effect.gen({ self: this }, function* () {
      if (this.store.job(job.id).state !== "queued") return
      let completion = Promise.resolve()
      const work = Effect.promise((signal) => completion = this.runJob(job.id, signal)).pipe(
        // Wait for the runner's finally block before taking the next queued job.
        Effect.onInterrupt(() => Effect.promise(() => completion)),
      )
      const fiber = yield* Effect.forkChild(work)
      this.active = { id: job.id, fiber }
      yield* Fiber.await(fiber)
      this.active = null
    })))
    return this.store.job(job.id)
  }
  private progress(id: string, message: string) { this.store.event(this.store.job(id), message) }
  private async runJob(id: string, cancellation: AbortSignal) {
    let job = this.store.job(id)
    this.store.event({ ...job, state: "running" }, "Starting isolated execution")
    try {
      const signal = AbortSignal.any([cancellation, AbortSignal.timeout(job.kind === "run" ? 31 * 60_000 : 30 * 60_000)])
      if (job.kind === "generate") await this.generate(job, signal)
      else await this.validate(job, this.store.version(job.versionId!), signal, job.kind === "run")
      job = this.store.job(id)
      if (job.state === "running") this.store.event({ ...job, state: "succeeded" }, job.kind === "run" ? "Manual run finished. Review coverage and results." : "Validation passed. Review the sample and runbook before approving.")
    } catch (error) {
      job = this.store.job(id)
      if (job.state !== "cancelled") {
        const message = describe(error).slice(0, 10_000)
        this.store.event({ ...job, state: cancellation.aborted ? "interrupted" : "failed" }, message)
        this.store.message(job.sourceId, "assistant", message)
      }
    }
  }
  private async generate(job: Job, signal: AbortSignal) {
    const source = this.store.source(job.sourceId)
    const conversation = this.detail(source.id).messages.slice(-20)
    const evidence: Evidence[] = []
    // Saved inspection artifacts survive questions and subsequent corrections.
    // Live validation still runs on every candidate; cached evidence is never
    // itself sufficient to approve a version.
    for (const previous of this.detail(source.id).jobs.filter((item) => item.id !== job.id && item.kind === "generate").slice(0, 3)) {
      try {
        const saved = Schema.decodeSync(Schema.fromJsonString(Schema.Array(Evidence)))(this.store.readArtifact(previous.id, "evidence.json"))
        for (const page of saved) {
          try { permittedUrl(page.finalUrl, source.brief) } catch { continue }
          if (!evidence.some((item) => item.finalUrl === page.finalUrl && item.strategy === page.strategy)) evidence.push(page)
        }
      } catch { /* This job may have ended before collecting evidence. */ }
    }
    if (evidence.length) this.store.saveEvidence(job.id, evidence)
    let feedback = "", repairs = 0
    const history: string[] = []
    for (let step = 0; step < 20; step++) {
      signal.throwIfAborted()
      if (this.store.source(source.id).revision !== source.revision) throw new Error("Source changed during generation. Generate a candidate for the updated brief.")
      this.progress(job.id, `Agent step ${step + 1}/20${repairs ? ` · repair ${repairs}/3` : ""}`)
      let decision: AgentDecision
      try {
        decision = Schema.decodeSync(AgentDecision)(await this.decide(JSON.stringify({
          brief: source.brief, conversation, contract: runtimeFile("contract.ts"), history,
          evidence: evidence.slice(-12).map((page) => ({
            url: page.url, finalUrl: page.finalUrl, strategy: page.strategy, label: page.label,
            html: (page.dom ?? page.html)?.slice(0, 12_000) ?? null,
            json: JSON.stringify(page.json).slice(0, 12_000), text: page.text.slice(0, 4000), links: page.links.slice(0, 50),
          })),
          feedback: feedback.slice(0, 60_000),
        }), signal))
      } catch (error) {
        signal.throwIfAborted(); feedback = describe(error)
        if (error instanceof SourceError && error.kind === "provider") throw error
        history.push(`Model response failed: ${feedback.slice(0, 1000)}`); continue
      }
      if (decision.action === "question") {
        this.store.message(source.id, "assistant", decision.message)
        this.store.event({ ...this.store.job(job.id), state: "needs-input" }, decision.message)
        return
      }
      if (decision.action === "inspect") {
        this.progress(job.id, `Investigating ${decision.url} using ${decision.strategy}: ${decision.reason}`)
        try {
          permittedUrl(decision.url, source.brief)
          const inspection = { ...manifest(source, [{ label: "index", strategy: decision.strategy, waitFor: null }]), seedUrls: [decision.url], limits: { maxPages: 1, maxRecords: 0, timeoutSeconds: 90 } }
          const result = await this.runner.run({ "manifest.json": JSON.stringify(inspection) }, source.brief.allowedDomains, { signal, timeoutSeconds: 90, inspect: true })
          if (result.errors.length) throw new Error(result.errors.join("\n"))
          for (const page of result.evidence) {
            if (!page || typeof page.finalUrl !== "string" || typeof page.text !== "string") throw new Error("Invalid investigation evidence")
            permittedUrl(page.finalUrl, source.brief)
            evidence.push(page)
          }
          if (JSON.stringify(evidence).length > 15_000_000) throw new Error("Investigation fixture budget exceeded. Narrow the source scope.")
          this.store.saveEvidence(job.id, evidence)
          feedback = "Inspection succeeded. Inspect detail examples or generate the package when evidence is sufficient."
        } catch (error) { signal.throwIfAborted(); feedback = `Inspection failed: ${describe(error)}` }
        history.push(`${decision.strategy} ${decision.url}: ${feedback}`)
        continue
      }
      if (!evidence.length) { feedback = "Inspect at least one real page before generating a package."; continue }
      let version: ScraperVersion | undefined
      try {
        const files = {
          ...packageFiles(source, decision.package, evidence),
          ...(this.runner.identity ? { "runtime.json": JSON.stringify({ image: await this.runner.identity(signal), contractVersion: 1 }) } : {}),
        }
        version = { id: randomUUID(), sourceId: source.id, revision: source.revision, digest: digestFiles(files), brief: source.brief, draft: decision.package, createdAt: now(), report: null, samples: [], approvedAt: null }
        this.store.writeArtifact(version.id, "package.json", JSON.stringify(files))
        this.store.saveVersion(version)
        this.store.saveJob({ ...this.store.job(job.id), versionId: version.id })
        this.progress(job.id, "Generated a candidate package. Checking types, fixture tests, and live sample.")
        await this.validate(job, version, signal, false)
        this.store.message(source.id, "assistant", `The scraper passed validation. ${decision.package.rationale}\n\nReview Samples, Validation, and Runbook, then approve this version when satisfied.`)
        return
      } catch (error) {
        signal.throwIfAborted()
        feedback = `Validation failed: ${describe(error)}\nPrevious candidate: ${JSON.stringify(decision.package)}`
        this.progress(job.id, `Candidate failed validation: ${describe(error).slice(0, 1000)}`)
        if (repairs++ >= 3) throw new Error(`Repair budget exhausted. Revise the guidance and try again. Last failure: ${describe(error)}`)
      }
    }
    throw new Error("Agent step budget exhausted. Review the investigation and narrow the guidance before retrying.")
  }
  private async validate(job: Job, version: ScraperVersion, signal: AbortSignal, manual: boolean) {
    const files = this.files(version)
    const savedManifest = Schema.decodeSync(Schema.fromJsonString(Manifest))(files["manifest.json"] ?? "null")
    const currentManifest: Manifest = manual ? { ...savedManifest, limits: { maxPages: 1000, maxRecords: 10_000, timeoutSeconds: 1800 } } : savedManifest
    const runFiles = { ...files, "manifest.json": JSON.stringify(currentManifest) }
    if (!manual) this.store.saveVersion({ ...version, report: null, samples: [] })
    this.store.saveJob({ ...this.store.job(job.id), report: null })
    this.store.saveResults(job.id, [])
    let testsPassed = manual
    try {
      if (!manual) {
        this.progress(job.id, "Typechecking and running captured-fixture tests without network access")
        await this.runner.run(files, [], { signal, timeoutSeconds: 120, test: true })
        testsPassed = true
      }
      signal.throwIfAborted()
      this.progress(job.id, manual ? "Running the approved package" : "Collecting a bounded live sample")
      const result = await this.runner.run(runFiles, version.brief.allowedDomains, {
        signal, timeoutSeconds: currentManifest.limits.timeoutSeconds,
        onProgress: (partial) => {
          if (signal.aborted) return
          const checkpoint = validateRecords(partial.records, version.sourceId, version.brief, { testsPassed, visitedCount: partial.visitedCount, errors: ["Execution has not completed; these results are partial."], coverage: partial.coverage, requireNonempty: false })
          this.store.saveResults(job.id, checkpoint.records)
          this.store.saveJob({ ...this.store.job(job.id), report: checkpoint.report })
        },
      })
      const { records, report } = validateRecords(result.records, version.sourceId, version.brief, { testsPassed, visitedCount: result.visitedCount, errors: result.errors, coverage: result.coverage, requireNonempty: !manual })
      signal.throwIfAborted()
      this.store.saveResults(job.id, records)
      this.store.saveJob({ ...this.store.job(job.id), report })
      if (!manual) this.store.saveVersion({ ...version, samples: records.slice(0, 20), report })
      if (!report.passed) throw new Error(report.errors.join("\n"))
    } catch (error) {
      if (!manual && !signal.aborted) {
        const latest = this.store.version(version.id)
        if (!latest.report) {
          const { report } = validateRecords([], version.sourceId, version.brief, { testsPassed, visitedCount: 0, errors: [describe(error)], coverage: "Validation did not complete." })
          this.store.saveVersion({ ...version, report, samples: [] })
          this.store.saveJob({ ...this.store.job(job.id), report })
          this.store.saveResults(job.id, [])
        }
      }
      throw error
    }
  }
  /** Test and CLI hook: wait for current work without tying it to an HTTP connection. */
  idle() {
    return Effect.runPromise(Effect.gen({ self: this }, function* () {
      const done = yield* Deferred.make<void>()
      yield* Queue.offer(this.queue, Deferred.succeed(done, undefined).pipe(Effect.asVoid))
      yield* Deferred.await(done)
    }))
  }
}
