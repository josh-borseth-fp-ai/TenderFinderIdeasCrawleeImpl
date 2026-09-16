import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Evidence, PackageDraft, Source } from "../../domain/Source.ts"

export const runtimeFile = (name: string) => readFileSync(join(process.env.SCRAPER_RUNTIME_DIR ?? join(process.cwd(), "runner"), name), "utf8")
export function manifest(source: Source, routes: PackageDraft["routes"], run = false) {
  return {
    formatVersion: 1, sourceId: source.id, revision: source.revision, entrypoint: "scraper.ts",
    seedUrls: source.brief.seedUrls, allowedDomains: source.brief.allowedDomains,
    includePatterns: source.brief.includePatterns, excludePatterns: source.brief.excludePatterns, routes,
    limits: { maxPages: run ? 1000 : 50, maxRecords: run ? 10_000 : 200, timeoutSeconds: run ? 1800 : 600 },
  }
}
export function packageFiles(source: Source, draft: PackageDraft, evidence: Evidence[]): Record<string, string> {
  if (!draft.routes.length || draft.routes.length > 10 || !draft.routes.some((route) => route.label === "index")) throw new Error("Package routes must include index and at most ten routes")
  if (new Set(draft.routes.map((route) => route.label)).size !== draft.routes.length) throw new Error("Route labels must be unique")
  if (!draft.code.trim() || !draft.tests.trim() || !draft.runbook.trim()) throw new Error("Code, tests, and runbook are required")
  if (draft.code.length + draft.tests.length + draft.runbook.length > 250_000) throw new Error("Generated package exceeds size limit")
  const packageJson = JSON.parse(runtimeFile("package.json")) as Record<string, unknown>
  packageJson.scripts = { test: "node --import tsx --test scraper.test.ts", typecheck: "tsc --noEmit --allowImportingTsExtensions --skipLibCheck --module nodenext --target es2022 scraper.ts scraper.test.ts" }
  return {
    "manifest.json": JSON.stringify(manifest(source, draft.routes), null, 2),
    "brief.json": JSON.stringify(source.brief, null, 2),
    "scraper.ts": draft.code,
    "scraper.test.ts": draft.tests,
    "contract.ts": runtimeFile("contract.ts"),
    "fixtures.json": JSON.stringify(evidence, null, 2),
    "package.json": JSON.stringify(packageJson, null, 2),
    "package-lock.json": runtimeFile("package-lock.json"),
    "SCRAPER.md": `# ${source.brief.name}\n\n${draft.runbook}\n\n## Runtime contract\n\n${draft.rationale}\n\nUses the self-hosted bid-desk-runner:1 runtime (Crawlee 3.18.1, Playwright 1.59.1 and bundled headless Chromium). No Browserbase or model key is required to run an approved scraper.\n\n- Offline tests: npm ci --ignore-scripts && npm test\n- Isolated execution, from the Bid Desk repository: bun run scraper:run /absolute/path/to/extracted-package\n- Build the runtime first with bun run runner:build. Docker must be running.\n- Preview limits: 50 pages, 200 raw records, 10 minutes; the review shows at most 20 valid samples.\n- Manual runs: 1,000 pages, 10,000 raw records, 30 minutes. A bounded result is not exhaustive coverage.\n- Missing facts stay null; attachment links are retained without document parsing.\n- Network access is restricted to the source domains in manifest.json and public HTTP(S) addresses. Add required CDN/API hosts to the source brief and regenerate if necessary.\n- Login/CAPTCHA barriers require a future human-takeover integration.\n- If validation fails, inspect errors and fixture expectations, revise the source guidance, and generate a new candidate. Never edit an approved package in place.\n`,
  }
}
