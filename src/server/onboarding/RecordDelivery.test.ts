import { describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { recoverRecordDelivery } from "./Runner.ts"

describe("durable runner record delivery", () => {
  it("replays interrupted delivery and acknowledges only committed batches", () => {
    const directory = mkdtempSync(join(tmpdir(), "delivery-test-"))
    try {
      const delivery = join(directory, "record-delivery")
      mkdirSync(delivery)
      const path = join(delivery, `${randomUUID()}.json`)
      const record = { title: "Bridge repair", sourceUrl: "https://example.com/1", evidence: "Bridge repair" }
      writeFileSync(path, JSON.stringify({ records: [record], visitedCount: 1 }))
      expect(() => recoverRecordDelivery(directory, () => { throw new Error("Database unavailable") })).toThrow("Database unavailable")
      expect(existsSync(path)).toBe(true)
      const received: unknown[] = []
      recoverRecordDelivery(directory, (records) => received.push(...records))
      expect(received).toEqual([record])
      expect(existsSync(path)).toBe(false)
      recoverRecordDelivery(directory, (records) => received.push(...records))
      expect(received).toHaveLength(1)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it("rejects malicious links and malformed persisted worker batches", () => {
    const directory = mkdtempSync(join(tmpdir(), "delivery-test-"))
    try {
      const delivery = join(directory, "record-delivery"), outside = join(directory, "outside")
      mkdirSync(outside)
      symlinkSync(outside, delivery)
      expect(() => recoverRecordDelivery(directory, () => {})).toThrow("Invalid record delivery directory")
      rmSync(delivery)
      mkdirSync(delivery)
      const target = join(outside, "secret.json"), path = join(delivery, `${randomUUID()}.json`)
      writeFileSync(target, JSON.stringify({ records: [], visitedCount: 0 }))
      symlinkSync(target, path)
      expect(() => recoverRecordDelivery(directory, () => {})).toThrow()
      rmSync(path)
      writeFileSync(path, JSON.stringify({ records: [], visitedCount: -1 }))
      expect(() => recoverRecordDelivery(directory, () => {})).toThrow()
      expect(existsSync(path)).toBe(true)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
