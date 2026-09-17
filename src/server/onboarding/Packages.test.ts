import { afterEach, describe, expect, it, vi } from "vitest"
import { Schema } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MANUAL_LIMITS, PREVIEW_LIMITS, REVIEW_SAMPLE_LIMIT } from "../../../runner/contract.ts"
import { AgentDecision, PackageDraft, RuntimePackageJson, emptyBrief } from "../../domain/Source.ts"
import { manifest, packageFiles, runtimeFile } from "./Packages.ts"

const source = { id: "source", revision: 1, brief: emptyBrief("City & Works", "https://example.com"), approvedVersionId: null, createdAt: "then", updatedAt: "now" }
const draft: PackageDraft = {
  rationale: "Observed <main> & JSON; {{literal}} is source text.",
  runbook: "## Mapping\n\n```ts\na < b && c > d\n```\n\n[API](https://example.com?q=one&next=two)",
  code: "export const extract = () => []; export const discover = () => [];",
  tests: "import { test } from 'node:test'; test('fixture', () => {});",
  routes: [{ label: "index", strategy: "cheerio", waitFor: null }],
}
const directories: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe("scraper package assembly", () => {
  it.each([
    ["empty routes", { routes: [] }],
    ["too many routes", { routes: [...draft.routes, ...Array.from({ length: 10 }, (_, i) => ({ ...draft.routes[0], label: `detail-${i}` }))] }],
    ["missing index", { routes: [{ ...draft.routes[0], label: "detail" }] }],
    ["duplicate labels", { routes: [...draft.routes, ...draft.routes] }],
    ["blank code", { code: " \n\t" }],
    ["blank tests", { tests: "" }],
    ["blank runbook", { runbook: "\t" }],
    ["combined size", { code: "x".repeat(250_000 - draft.tests.length - draft.runbook.length + 1) }],
  ])("rejects %s through the same schema used for model responses", (_name, invalid) => {
    const candidate = { ...draft, ...invalid }
    expect(() => Schema.decodeUnknownSync(PackageDraft)(candidate)).toThrow()
    expect(() => Schema.decodeUnknownSync(AgentDecision)({ action: "generate", package: candidate })).toThrow()
  })

  it("accepts the exact size boundary and preserves code whitespace", () => {
    const exact = { ...draft, code: "x".repeat(250_000 - draft.tests.length - draft.runbook.length) }
    expect(Schema.decodeSync(PackageDraft)(exact)).toEqual(exact)
    const indented = { ...draft, code: `  ${draft.code}\n`, tests: `\n${draft.tests}\n` }
    const files = packageFiles(source, indented, [])
    expect(files["scraper.ts"]).toBe(indented.code)
    expect(files["scraper.test.ts"]).toBe(indented.tests)
    expect(() => packageFiles(source, { ...draft, code: " " }, [])).toThrow()
  })

  it("preserves Markdown and pinned dependencies and documents the execution limits", () => {
    const files = packageFiles(source, draft, [])
    const runbook = files["SCRAPER.md"]!
    const runtime = Schema.decodeSync(Schema.fromJsonString(RuntimePackageJson))(runtimeFile("package.json"))
    const packaged = Schema.decodeSync(Schema.fromJsonString(RuntimePackageJson))(files["package.json"]!)
    expect(packaged.dependencies).toEqual(runtime.dependencies)
    expect(packaged.name).toBe(runtime.name)
    expect(packaged.private).toBe(runtime.private)
    expect(files["package-lock.json"]).toBe(runtimeFile("package-lock.json"))
    expect(runbook).toContain(`# ${source.brief.name}`)
    expect(runbook).toContain(draft.runbook)
    expect(runbook).toContain(draft.rationale)
    expect(runbook).toContain(`Crawlee ${runtime.dependencies.crawlee}, Playwright ${runtime.dependencies.playwright}`)
    expect(manifest(source, draft.routes).limits).toEqual(PREVIEW_LIMITS)
    expect(manifest(source, draft.routes, true).limits).toEqual(MANUAL_LIMITS)
    expect(runbook).toContain(`${PREVIEW_LIMITS.maxPages} pages, ${PREVIEW_LIMITS.maxRecords} raw records, ${PREVIEW_LIMITS.timeoutSeconds / 60} minutes`)
    expect(runbook).toContain(`${MANUAL_LIMITS.maxPages} pages, ${MANUAL_LIMITS.maxRecords} raw records, ${MANUAL_LIMITS.timeoutSeconds / 60} minutes`)
    expect(runbook).toContain(`at most ${REVIEW_SAMPLE_LIMIT} valid samples`)
  })

  it("uses runtime package versions and fails visibly for missing template fields", () => {
    const directory = mkdtempSync(join(tmpdir(), "scraper-template-"))
    directories.push(directory)
    for (const name of ["contract.ts", "package.json", "package-lock.json", "SCRAPER.md.hbs"]) writeFileSync(join(directory, name), runtimeFile(name))
    vi.stubEnv("SCRAPER_RUNTIME_DIR", directory)
    const runtime = Schema.decodeSync(Schema.fromJsonString(RuntimePackageJson))(runtimeFile("package.json"))
    writeFileSync(join(directory, "package.json"), JSON.stringify({ ...runtime, dependencies: { ...runtime.dependencies, crawlee: "9.8.7", playwright: "6.5.4" } }))
    expect(packageFiles(source, draft, [])["SCRAPER.md"]).toContain("Crawlee 9.8.7, Playwright 6.5.4")
    writeFileSync(join(directory, "SCRAPER.md.hbs"), "{{missingField}}")
    expect(() => packageFiles(source, draft, [])).toThrow(/missingField/)
  })
})
