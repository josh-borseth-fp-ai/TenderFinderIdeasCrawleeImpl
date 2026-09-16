import { createRequire } from "node:module"
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync } from "node:fs"
import { join, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { BidRecord, Evidence, Job, ProgressEvent, ScraperVersion, Source, SourceBrief, SourceDetail, SourceMessage } from "../../domain/Source.ts"

import { and, desc, eq, gt, sql } from "drizzle-orm"
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core"
import * as tables from "./db/schema.ts"

const require = createRequire(import.meta.url)
const now = () => new Date().toISOString()
const required = <T>(value: T | undefined, name: string): T => {
  if (!value) throw new Error(`${name} not found`)
  return value
}

/** Drizzle owns queries, JSON column codecs, transactions, and migration history. */
export class SourceStore {
  readonly root: string
  private readonly db: SQLiteAsyncDatabase<"sync", unknown>
  private readonly closeDatabase: () => void
  constructor(directory: string) {
    this.root = resolve(directory)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    // Only the driver differs between the Bun app and Node/Vitest.
    const adapter = process.versions.bun ? "drizzle-orm/bun-sqlite" : "drizzle-orm/node-sqlite"
    const { drizzle } = require(adapter) as typeof import("drizzle-orm/node-sqlite")
    const { migrate } = require(`${adapter}/migrator`) as typeof import("drizzle-orm/node-sqlite/migrator")
    const db = drizzle(join(this.root, "sources.sqlite"))
    this.db = db
    this.closeDatabase = () => db.$client.close()
    db.run(sql`PRAGMA journal_mode=WAL`)
    db.run(sql`PRAGMA foreign_keys=ON`)
    db.run(sql`PRAGMA busy_timeout=5000`)
    migrate(db, { migrationsFolder: process.env.SCRAPER_MIGRATIONS_DIR ?? join(process.cwd(), "drizzle") })
  }
  close() { this.closeDatabase() }
  transaction<T>(fn: () => T): T {
    let result!: T
    this.db.transaction(() => { result = fn() }, { behavior: "immediate" })
    return result
  }
  list() { return this.db.select().from(tables.sources).orderBy(desc(sql`rowid`)).all().map((row) => row.payload) }
  source(id: string) { return required(this.db.select().from(tables.sources).where(eq(tables.sources.id, id)).get(), "Source").payload }
  version(id: string) { return required(this.db.select().from(tables.versions).where(eq(tables.versions.id, id)).get(), "Version").payload }
  job(id: string) { return required(this.db.select().from(tables.jobs).where(eq(tables.jobs.id, id)).get(), "Job").payload }
  jobs() { return this.db.select().from(tables.jobs).orderBy(desc(sql`rowid`)).all().map((row) => row.payload) }
  saveSource(source: Source) {
    this.db.insert(tables.sources).values({ id: source.id, payload: source }).onConflictDoUpdate({ target: tables.sources.id, set: { payload: source } }).run()
  }
  saveVersion(version: ScraperVersion) {
    this.db.insert(tables.versions).values({ id: version.id, sourceId: version.sourceId, payload: version }).onConflictDoUpdate({ target: tables.versions.id, set: { payload: version } }).run()
  }
  saveJob(job: Job) {
    this.db.insert(tables.jobs).values({ id: job.id, sourceId: job.sourceId, payload: job }).onConflictDoUpdate({ target: tables.jobs.id, set: { payload: job } }).run()
  }
  create(brief: SourceBrief): Source {
    const source: Source = { id: randomUUID(), brief, revision: 1, approvedVersionId: null, createdAt: now(), updatedAt: now() }
    this.saveSource(source)
    return source
  }
  update(id: string, revision: number, brief: SourceBrief): Source {
    return this.transaction(() => {
      const current = this.source(id)
      if (current.revision !== revision) throw new Error("Source changed. Refresh before saving.")
      const next = { ...current, brief, revision: revision + 1, updatedAt: now() }
      this.saveSource(next)
      return next
    })
  }
  message(sourceId: string, role: SourceMessage["role"], content: string) {
    const message: SourceMessage = { id: randomUUID(), role, content, createdAt: now() }
    this.db.insert(tables.messages).values({ id: message.id, sourceId, payload: message }).run()
    return message
  }
  detail(id: string): SourceDetail {
    return {
      source: this.source(id),
      messages: this.db.select().from(tables.messages).where(eq(tables.messages.sourceId, id)).orderBy(sql`rowid`).all().map((row) => row.payload),
      versions: this.db.select().from(tables.versions).where(eq(tables.versions.sourceId, id)).orderBy(desc(sql`rowid`)).all().map((row) => row.payload),
      jobs: this.db.select().from(tables.jobs).where(eq(tables.jobs.sourceId, id)).orderBy(desc(sql`rowid`)).all().map((row) => row.payload),
    }
  }
  event(job: Job, message: string) {
    this.transaction(() => {
      this.db.insert(tables.events).values({ jobId: job.id, sourceId: job.sourceId, message, createdAt: now() }).run()
      this.saveJob({ ...job, message, updatedAt: now() })
    })
  }
  events(sourceId: string, after: number): ProgressEvent[] {
    return this.db.select().from(tables.events).where(and(eq(tables.events.sourceId, sourceId), gt(tables.events.id, after))).orderBy(tables.events.id).limit(100).all()
  }
  recover() {
    for (const job of this.jobs()) if (["queued", "running"].includes(job.state)) {
      this.event({ ...job, state: "interrupted" }, "Server restarted. This job was interrupted; retry explicitly.")
    }
  }
  artifactPath(id: string, file: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-zA-Z0-9_.-]+$/.test(file)) throw new Error("Invalid artifact path")
    return join(this.root, "artifacts", id, file)
  }
  writeArtifact(id: string, file: string, content: string) {
    const path = this.artifactPath(id, file)
    mkdirSync(join(this.root, "artifacts", id), { recursive: true, mode: 0o700 })
    writeFileSync(`${path}.tmp`, content, { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  readArtifact(id: string, file: string) {
    const path = this.artifactPath(id, file)
    const info = lstatSync(path)
    if (!info.isFile() || info.size > 30 * 1024 * 1024) throw new Error("Invalid artifact")
    return readFileSync(path, "utf8")
  }
  saveEvidence(jobId: string, evidence: Evidence[]) { this.writeArtifact(jobId, "evidence.json", JSON.stringify(evidence)) }
  saveResults(jobId: string, records: BidRecord[]) { this.writeArtifact(jobId, "results.json", JSON.stringify(records, null, 2)) }
}

export const digestFiles = (files: Record<string, string>) => createHash("sha256").update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest("hex")
