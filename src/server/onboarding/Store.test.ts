import { afterEach, describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { emptyBrief, type Source } from "../../domain/Source.ts"
import { SourceStore } from "./Store.ts"

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const directory = () => { const path = mkdtempSync(join(tmpdir(), "source-migration-")); directories.push(path); return path }

describe("onboarding database migration", () => {
  it("rejects malformed persisted payloads when reading a source", () => {
    const path = directory(), store = new SourceStore(path)
    const source = store.create(emptyBrief("Source", "https://example.com"))
    const connection = new DatabaseSync(join(path, "sources.sqlite"))
    connection.prepare("UPDATE sources SET payload = ? WHERE id = ?").run(JSON.stringify({ ...source, revision: "invalid" }), source.id)
    connection.close()
    try {
      expect(() => store.source(source.id)).toThrow()
      expect(() => store.list()).toThrow()
    } finally { store.close() }
  })
  it("adopts the original JSON tables and reopens without losing saved sources", () => {
    const path = directory()
    const source: Source = { id: "saved-source", brief: emptyBrief("Existing source", "https://example.com"), revision: 7, approvedVersionId: null, createdAt: "then", updatedAt: "now" }
    const legacy = new DatabaseSync(join(path, "sources.sqlite"))
    legacy.exec("CREATE TABLE sources (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (1)")
    legacy.prepare("INSERT INTO sources VALUES (?, ?)").run(source.id, JSON.stringify(source))
    legacy.close()
    const first = new SourceStore(path)
    expect(first.detail(source.id)).toEqual({ source, messages: [], versions: [], jobs: [] })
    first.message(source.id, "user", "Preserve this guidance")
    first.close()
    const reopened = new SourceStore(path)
    expect(reopened.source(source.id)).toEqual(source)
    expect(reopened.detail(source.id).messages[0]?.content).toBe("Preserve this guidance")
    reopened.close()
  })
  it("rolls back related writes when an approval transaction fails", () => {
    const store = new SourceStore(directory())
    const source = store.create(emptyBrief("Source", "https://example.com"))
    expect(() => store.transaction(() => {
      store.saveSource({ ...source, approvedVersionId: "must-not-survive" })
      store.message(source.id, "assistant", "must-not-survive")
      throw new Error("Approval failed")
    })).toThrow("Approval failed")
    expect(store.source(source.id).approvedVersionId).toBeNull()
    expect(store.detail(source.id).messages).toHaveLength(0)
    store.close()
  })
})
