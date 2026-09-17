import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { BidDraft, Manifest, PackageFiles, RunnerBatch, RunnerResult, RuntimePin } from "../../../runner/contract.ts"
import { emptyBrief } from "../../domain/Source.ts"
import { manifest } from "./Packages.ts"

describe("shared runner boundary schemas", () => {
  it("accepts existing manifests and rejects unsafe execution limits and unknown routes", () => {
    const source = { id: "source", revision: 1, brief: emptyBrief("City", "https://example.com"), approvedVersionId: null, createdAt: "then", updatedAt: "now" }
    const valid = manifest(source, [{ label: "index", strategy: "cheerio", waitFor: null }])
    const decode = Schema.decodeSync(Schema.fromJsonString(Manifest))
    expect(decode(JSON.stringify(valid))).toEqual(valid)
    for (const timeoutSeconds of [0, -1, 1801, 1.5, "60"]) {
      expect(() => decode(JSON.stringify({ ...valid, limits: { ...valid.limits, timeoutSeconds } }))).toThrow()
    }
    expect(() => decode(JSON.stringify({ ...valid, routes: [{ label: "index", strategy: "browserbase", waitFor: null }] }))).toThrow()
  })

  it("validates nested worker evidence and error payloads before they reach the app", () => {
    const decode = Schema.decodeSync(Schema.fromJsonString(RunnerResult))
    const valid = { records: [], evidence: [], errors: [], visitedCount: 0, coverage: "No pages visited" }
    expect(decode(JSON.stringify(valid))).toEqual(valid)
    expect(() => decode(JSON.stringify({ ...valid, errors: [123] }))).toThrow()
    expect(() => decode(JSON.stringify({ ...valid, evidence: [{ finalUrl: "https://example.com" }] }))).toThrow()
    expect(() => decode("not JSON")).toThrow()
    const batch = Schema.decodeUnknownSync(RunnerBatch)
    expect(() => batch({ records: [], visitedCount: -1 })).toThrow()
    expect(() => batch({ records: Array(10_001).fill(null), visitedCount: 1 })).toThrow()
  })

  it("rejects invalid artifact contents and runtime pins", () => {
    expect(() => Schema.decodeUnknownSync(PackageFiles)({ "scraper.ts": { code: "invalid" } })).toThrow()
    const decode = Schema.decodeUnknownSync(RuntimePin)
    expect(decode({ image: `sha256:${"a".repeat(64)}`, contractVersion: 1 }).contractVersion).toBe(1)
    expect(() => decode({ image: "mutable:latest", contractVersion: 1 })).toThrow()
    expect(decode({ image: `sha256:${"a".repeat(64)}`, contractVersion: 2 }).contractVersion).toBe(2)
    expect(() => decode({ image: `sha256:${"a".repeat(64)}`, contractVersion: 3 })).toThrow()
  })

  it("preserves optional and nullable extraction fields while rejecting invalid facts", () => {
    const bid = { title: "Bridge repair", sourceUrl: "https://example.com/bid/1", evidence: "Bridge repair" }
    const decode = Schema.decodeUnknownSync(BidDraft)
    expect(decode(bid)).toEqual(bid)
    expect(decode({ ...bid, deadline: null }).deadline).toBeNull()
    expect(() => decode({ ...bid, status: "invented" })).toThrow()
    expect(() => decode({ ...bid, budget: Infinity })).toThrow()
  })
})
