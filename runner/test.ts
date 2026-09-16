import { run } from "node:test"

// Read the test runner's structured events instead of regex-matching TAP text.
let passed = 0, failed = 0
for await (const event of run({ files: ["/work/scraper.test.ts"] })) {
  if (event.type === "test:pass" && event.data.name !== event.data.file && event.data.details.type !== "suite" && !event.data.skip && !event.data.todo) passed++
  if (event.type === "test:fail") { failed++; console.error(event.data) }
  if (event.type === "test:stderr" || event.type === "test:stdout") console.error(event.data.message)
}
if (passed === 0 || failed > 0) process.exitCode = 1
