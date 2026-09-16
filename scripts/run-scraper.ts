import { readdirSync, readFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { DockerRunner } from "../src/server/onboarding/Runner.ts"
import { validateBrief, validateRecords } from "../src/server/onboarding/Records.ts"
import { SourceBrief } from "../src/domain/Source.ts"
import { Manifest } from "../runner/contract.ts"
import { Schema } from "effect"

const directory = process.argv[2]
if (!directory) throw new Error("Usage: bun run scraper:run /path/to/extracted-package")
const path = resolve(directory)
const files = Object.fromEntries(readdirSync(path).filter((name) => /^[a-zA-Z0-9_.-]+$/.test(name) && /\.(ts|json|md)$/.test(name)).map((name) => [name, readFileSync(join(path, name), "utf8")]))
const brief = validateBrief(Schema.decodeUnknownSync(Schema.fromJsonString(SourceBrief))(files["brief.json"]))
const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest))(files["manifest.json"])
const controller = new AbortController()
process.once("SIGINT", () => controller.abort())
const runner = new DockerRunner()
await runner.run(files, [], { signal: controller.signal, timeoutSeconds: 120, test: true })
const result = await runner.run(files, brief.allowedDomains, { signal: controller.signal, timeoutSeconds: Math.min(1800, Math.max(1, manifest.limits.timeoutSeconds)) })
const validated = validateRecords(result.records, manifest.sourceId, brief, { testsPassed: true, visitedCount: result.visitedCount, errors: result.errors, coverage: result.coverage })
console.log(JSON.stringify(validated, null, 2))
if (!validated.report.passed) process.exitCode = 1
