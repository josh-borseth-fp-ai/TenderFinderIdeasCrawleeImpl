import { createRequire } from "node:module"
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync } from "node:fs"
import { join, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Schema } from "effect"
import { ActionRecord, Collection, Conversation, SavedMessage, type ConversationDetail, type ResultPage } from "../../domain/Conversation.ts"
import { BidRecord as BidRecordSchema } from "../../domain/Source.ts"
import { Job, ScraperVersion, Source, SourceMessage, type BidRecord, type Evidence, type ProgressEvent, type SourceBrief, type SourceDetail } from "../../domain/Source.ts"

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
  private db: SQLiteAsyncDatabase<"sync", unknown>
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
    this.importLegacy()
  }
  close() { this.closeDatabase() }
  transaction<T>(fn: () => T): T {
    let result!: T
    const parent = this.db
    parent.transaction((transaction) => {
      this.db = transaction
      try { result = fn() } finally { this.db = parent }
    }, { behavior: "immediate" })
    return result
  }
  list() { return this.db.select().from(tables.sources).orderBy(desc(sql`rowid`)).all().map((row) => Schema.decodeSync(Source)(row.payload)) }
  source(id: string) { return Schema.decodeSync(Source)(required(this.db.select().from(tables.sources).where(eq(tables.sources.id, id)).get(), "Source").payload) }
  version(id: string) { return Schema.decodeSync(ScraperVersion)(required(this.db.select().from(tables.versions).where(eq(tables.versions.id, id)).get(), "Version").payload) }
  job(id: string) { return Schema.decodeSync(Job)(required(this.db.select().from(tables.jobs).where(eq(tables.jobs.id, id)).get(), "Job").payload) }
  jobs() { return this.db.select().from(tables.jobs).orderBy(desc(sql`rowid`)).all().map((row) => Schema.decodeSync(Job)(row.payload)) }
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
      messages: this.db.select().from(tables.messages).where(eq(tables.messages.sourceId, id)).orderBy(sql`rowid`).all().map((row) => Schema.decodeSync(SourceMessage)(row.payload)),
      versions: this.db.select().from(tables.versions).where(eq(tables.versions.sourceId, id)).orderBy(desc(sql`rowid`)).all().map((row) => Schema.decodeSync(ScraperVersion)(row.payload)),
      jobs: this.db.select().from(tables.jobs).where(eq(tables.jobs.sourceId, id)).orderBy(desc(sql`rowid`)).all().map((row) => Schema.decodeSync(Job)(row.payload)),
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
    for (const row of this.db.select().from(tables.chatMessages).all()) {
      const message = Schema.decodeSync(SavedMessage)(row.payload)
      if (message.status === "streaming") this.saveChatMessage({ ...message, status: "interrupted" })
    }
    for (const row of this.db.select().from(tables.collections).all()) {
      const collection = Schema.decodeSync(Collection)(row.payload)
      if (collection.state === "running") this.saveCollection({ ...collection, state: "partial", coverage: "Collection interrupted by a server restart. Continue to resume.", updatedAt: now() })
    }
    for (const job of this.jobs()) if (["queued", "running"].includes(job.state)) {
      this.event({ ...job, state: "interrupted" }, "Server restarted. This job was interrupted; retry explicitly.")
    }
  }
  conversations() { return this.db.select().from(tables.conversations).orderBy(desc(sql`rowid`)).all().map((row) => Schema.decodeSync(Conversation)(row.payload)) }
  conversation(id: string) { return Schema.decodeSync(Conversation)(required(this.db.select().from(tables.conversations).where(eq(tables.conversations.id, id)).get(), "Conversation").payload) }
  createConversation(id: string = randomUUID(), title = "New chat") {
    const previous = this.db.select().from(tables.conversations).where(eq(tables.conversations.id, id)).get()
    if (previous) return Schema.decodeSync(Conversation)(previous.payload)
    const value: Conversation = { id, title, createdAt: now(), updatedAt: now() }
    this.db.insert(tables.conversations).values({ id, payload: value }).run()
    return value
  }
  renameConversation(id: string, title: string) {
    this.db.update(tables.conversations).set({ payload: { ...this.conversation(id), title: title.slice(0, 100), updatedAt: now() } }).where(eq(tables.conversations.id, id)).run()
  }
  linkSource(conversationId: string, sourceId: string) {
    this.conversation(conversationId); this.source(sourceId)
    this.db.insert(tables.conversationSources).values({ conversationId, sourceId }).onConflictDoNothing().run()
  }
  sourceConversation(sourceId: string) { const row = this.db.select().from(tables.conversationSources).where(eq(tables.conversationSources.sourceId, sourceId)).get(); if (row) return this.conversation(row.conversationId); return this.transaction(() => { const conversation = this.createConversation(`source-${sourceId}`, this.source(sourceId).brief.name); this.linkSource(conversation.id, sourceId); return conversation }) }
  linkedSources(conversationId: string) { return this.db.select().from(tables.conversationSources).where(eq(tables.conversationSources.conversationId, conversationId)).all().map((row) => this.source(row.sourceId)) }
  chatMessage(id: string) { const row = this.db.select().from(tables.chatMessages).where(eq(tables.chatMessages.id, id)).get(); return row ? Schema.decodeSync(SavedMessage)(row.payload) : undefined }
  saveChatMessage(message: SavedMessage) {
    this.db.insert(tables.chatMessages).values({ id: message.id, conversationId: message.conversationId, payload: message }).onConflictDoUpdate({ target: tables.chatMessages.id, set: { payload: message } }).run()
  }
  conversationDetail(id: string): ConversationDetail {
    return { conversation: this.conversation(id), messages: this.db.select().from(tables.chatMessages).where(eq(tables.chatMessages.conversationId, id)).orderBy(sql`rowid`).all().map((row) => Schema.decodeSync(SavedMessage)(row.payload)), sources: this.linkedSources(id).map((source) => ({ source, job: this.detail(source.id).jobs[0] ?? null, collection: this.latestCollection(source.id) })) }
  }
  actionRecord(id: string) { const row = this.db.select().from(tables.actions).where(eq(tables.actions.id, id)).get(); return row ? Schema.decodeSync(ActionRecord)(row.payload) : undefined }
  action(id: string, fingerprint: string) {
    const row = this.db.select().from(tables.actions).where(eq(tables.actions.id, id)).get()
    if (!row) return undefined
    const value = Schema.decodeSync(ActionRecord)(row.payload)
    if (value.fingerprint !== fingerprint) throw new Error("Request ID was already used for a different action")
    return value.sourceId
  }
  saveAction(id: string, fingerprint: string, sourceId: string) { this.db.insert(tables.actions).values({ id, payload: { fingerprint, sourceId } }).run() }
  collection(id: string) { return Schema.decodeSync(Collection)(required(this.db.select().from(tables.collections).where(eq(tables.collections.id, id)).get(), "Collection").payload) }
  latestCollection(sourceId: string) { const row = this.db.select().from(tables.collections).where(eq(tables.collections.sourceId, sourceId)).orderBy(desc(sql`rowid`)).get(); return row ? Schema.decodeSync(Collection)(row.payload) : null }
  saveCollection(value: Collection) { this.db.insert(tables.collections).values({ id: value.id, sourceId: value.sourceId, payload: value }).onConflictDoUpdate({ target: tables.collections.id, set: { payload: value } }).run() }
  appendRecords(collectionId: string, records: readonly BidRecord[]) {
    this.transaction(() => {
      for (const record of records) this.db.insert(tables.collectionRecords).values({ collectionId, id: record.id, payload: record }).onConflictDoUpdate({ target: [tables.collectionRecords.collectionId, tables.collectionRecords.id], set: { payload: record } }).run()
      const count = this.db.select({ count: sql<number>`count(*)` }).from(tables.collectionRecords).where(eq(tables.collectionRecords.collectionId, collectionId)).get()!.count
      this.saveCollection({ ...this.collection(collectionId), count, updatedAt: now() })
    })
  }
  resultPage(id: string, page = 1): ResultPage {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid page")
    return { collection: this.collection(id), page, pageSize: 50, records: this.db.select().from(tables.collectionRecords).where(eq(tables.collectionRecords.collectionId, id)).orderBy(sql`rowid`).limit(50).offset((page - 1) * 50).all().map((row) => Schema.decodeSync(BidRecordSchema)(row.payload)) }
  }
  private importLegacy() {
    for (const source of this.list()) {
      const id = `source-${source.id}`
      // Deterministic IDs make migration repeatable without copying live conversations.
      if (this.db.select().from(tables.conversationSources).where(eq(tables.conversationSources.sourceId, source.id)).get()) continue
      this.transaction(() => {
        this.createConversation(id, source.brief.name); this.linkSource(id, source.id)
        for (const message of this.detail(source.id).messages) this.saveChatMessage({ ...message, id: `legacy-${message.id}`, conversationId: id, sourceIds: [source.id], status: "complete" })
      })
    }
    for (const job of this.jobs().filter((job) => job.kind === "run" && job.versionId)) {
      if (this.db.select().from(tables.collections).where(eq(tables.collections.id, job.id)).get()) continue
      let records: readonly BidRecord[]
      try { records = Schema.decodeSync(Schema.fromJsonString(Schema.Array(BidRecordSchema)))(this.readArtifact(job.id, "results.json")) } catch { continue }
      // Legacy coverage cannot prove exhaustive traversal.
      this.saveCollection({ id: job.id, sourceId: job.sourceId, versionId: job.versionId!, state: "partial", count: 0, visitedCount: job.report?.visitedCount ?? 0, coverage: `Legacy collection: ${job.report?.coverage ?? job.message}`, createdAt: job.createdAt, updatedAt: job.updatedAt })
      this.appendRecords(job.id, records)
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
