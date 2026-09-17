import { Schema } from "effect"
import Handlebars from "handlebars"
import { MANUAL_LIMITS, PREVIEW_LIMITS, REVIEW_SAMPLE_LIMIT, type Manifest, type PackageFiles } from "../../../runner/contract.ts"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PackageDraft, RuntimePackageJson, type Evidence, type Source } from "../../domain/Source.ts"

export const runtimeFile = (name: string) => readFileSync(join(process.env.SCRAPER_RUNTIME_DIR ?? join(process.cwd(), "runner"), name), "utf8")
export function manifest(source: Source, routes: PackageDraft["routes"], run = false): Manifest {
  return {
    formatVersion: 1, sourceId: source.id, revision: source.revision, entrypoint: "scraper.ts",
    seedUrls: [...source.brief.seedUrls], allowedDomains: [...source.brief.allowedDomains],
    includePatterns: [...source.brief.includePatterns], excludePatterns: [...source.brief.excludePatterns], routes: [...routes],
    limits: run ? MANUAL_LIMITS : PREVIEW_LIMITS,
  }
}
export function packageFiles(source: Source, input: PackageDraft, evidence: Evidence[]): PackageFiles {
  const draft = Schema.decodeSync(PackageDraft)(input)
  const packageJson = Schema.decodeSync(Schema.fromJsonString(RuntimePackageJson))(runtimeFile("package.json"))
  // Markdown output: preserve code fences, links, and literal template-like text.
  const renderRunbook = Handlebars.compile(runtimeFile("SCRAPER.md.hbs"), { strict: true, noEscape: true })
  const scripts = { test: "node --import tsx --test scraper.test.ts", typecheck: "tsc --noEmit --allowImportingTsExtensions --skipLibCheck --module nodenext --target es2022 scraper.ts scraper.test.ts" }
  return {
    "manifest.json": JSON.stringify(manifest(source, draft.routes), null, 2),
    "brief.json": JSON.stringify(source.brief, null, 2),
    "scraper.ts": draft.code,
    "scraper.test.ts": draft.tests,
    "contract.ts": runtimeFile("contract.ts"),
    "fixtures.json": JSON.stringify(evidence, null, 2),
    "package.json": JSON.stringify({ ...packageJson, scripts }, null, 2),
    "package-lock.json": runtimeFile("package-lock.json"),
    "SCRAPER.md": renderRunbook({
      name: source.brief.name, runbook: draft.runbook, rationale: draft.rationale,
      versions: packageJson.dependencies,
      preview: PREVIEW_LIMITS, manual: MANUAL_LIMITS, reviewSampleLimit: REVIEW_SAMPLE_LIMIT,
      previewMinutes: PREVIEW_LIMITS.timeoutSeconds / 60, manualMinutes: MANUAL_LIMITS.timeoutSeconds / 60,
    }),
  }
}
