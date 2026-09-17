# Source onboarding implementation plan

Target: self-hosted Crawlee with bundled headless Playwright Chromium, BrowserPool
fingerprints, and no Browserbase dependency. HTTP and Cheerio remain available for
stages that do not require rendering.

## Stage 1 — onboarding foundation (this change)

- Persist source briefs, conversations, immutable candidate packages, validation,
  approvals, jobs, and results in SQLite and a local artifact directory.
- Provide one saved chat with URL discovery, inline full opportunity collections,
  conversation history, and source confirmation after collection. Keep technical
  setup, validation, versions, package files, and runbooks internal.
- Investigate public HTML/JSON and rendered pages. Generate TypeScript scrapers,
  fixture tests, SCRAPER.md, and minimal metadata. Automatically repair up to three
  times; ask about missing intent rather than inventing it.
- Validate in an isolated Docker runner. Require passing tests and verified live
  extraction (or explicit zero-total evidence), then collect all opportunities before source confirmation.
  Collection batches resume through persistent Crawlee queues and browser cursors.
  Refreshes use the exact confirmed version.
- Establish a browser-session controller with agent-controlled, human-controlled,
  and awaiting-human ownership. Retain the same page/context during pauses, gate
  automated actions, and distinguish human waiting from execution deadlines.
- Keep the browser and generated code in the worker. Use a network-disabled
  container and a public-address/domain-filtered `proxy-chain` gateway over a Unix socket; generated
  code cannot directly contact the host, private networks, or the internet.

## Stage 2 — live browser assistance (follow-up)

- Stream on demand using Playwright >=1.59 `page.screencast.start({ onFrame })`,
  relayed through an application WebSocket to a React canvas. Never expose CDP.
- Map canvas coordinates and keyboard events to Playwright input through the
  session controller. Add URL, Back, Reload, page/popup selection, Take control,
  and Continue crawl controls. Stop frames when nobody is watching.
- Pause autonomous navigation/input before granting control; continue on the same
  context with cookies intact. Suspend handler deadlines during bounded human
  waiting. Handle disconnects and expired ownership leases explicitly.
- Permit human resolution of login/CAPTCHA barriers in this stage. Stage 1 reports
  those barriers and keeps blocked collections incomplete.

## Defaults and acceptance

Single trusted operator; public web/JSON; standard procurement plus commercial
fields; open bids by default; missing facts remain null. No scheduled runs,
multi-tenancy, or attachment parsing. Store attachment links. Resource-bounded
execution, cancellation, restart recovery, stale-approval protection, and fixture
tests are required. Acceptance: URL → investigation → generated package →
internal fixture/live validation → full collection → confirm source → refresh →
reopen all saved results. Records persist individually and page at 50 per page;
exports include the full dataset. A cap, failure, or unresolved page cannot imply
complete coverage. Test static, JSON, browser, and mixed strategies.

## Implementation simplification

Use the installed Effect stack for jobs, lifecycle cleanup, structured model output,
typed APIs, SSE and reactive UI state. Use Drizzle ORM/Kit for SQLite and migrations,
Dockerode for containers, Effect Semaphore/Latch/Deferred for browser ownership and crawl permits,
Bun.Archive for tar downloads, csv-stringify for exports, and Apify's proxy-chain
for HTTP forwarding and CONNECT tunnels. Keep destination policy separate from
transport; use library traffic counters and Node pipeline for the Unix relay. Crawlee RequestQueue
owns URL deduplication. Keep the explicit mixed-strategy coordinator and source
network policy; AdaptivePlaywrightCrawler remains experimental and is not a
replacement for the complete HTTP/JSON and interactive-browser contract.

Drizzle and Dockerode were selected from the alternatives: do not also add Effect
SQL or a second child-process wrapper for the same responsibilities.
