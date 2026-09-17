# Bid Desk Chat

TypeScript chat with Effect v4, OpenRouter, and self-hosted Crawlee scraping.

## AI-assisted source onboarding

Open **Sources** from chat (or `/sources`) to teach the agent a procurement source.
Describe the starting pages, required bid fields, and exclusions. The agent
investigates public HTML/JSON or rendered pages, generates a TypeScript scraper
package, and tests it against captured fixtures and a bounded live sample.

```sh
bun install
bun run runner:build  # Docker required; includes Playwright 1.59.1 Chromium
bun run dev          # set OPENROUTER_API_KEY in .env for real generation
```

Review **Samples**, **Validation**, and **Runbook** before **Approve version**.
Approval binds the source revision, package SHA-256, and exact Docker image.
**Run approved version** executes that saved package without an LLM. Guidance
changes create new candidates while preserving the last approved version.
Download the package as a tar archive and run results as JSON or CSV.

Generated packages contain `SCRAPER.md`, `scraper.ts`, `scraper.test.ts`,
`contract.ts`, captured fixtures, the source brief, an execution manifest, pinned
dependencies/lockfile, and the runtime image identity. The generated module exports
`extract` and `discover`; optional `browse` uses gated browser actions for rendered
pagination. The runner owns Crawlee queues, network policy, and browser lifecycle.

Drizzle manages SQLite queries and versioned migrations in `drizzle/`; startup applies
pending migrations and preserves databases created by the initial onboarding version.
After changing the database schema, run `bun run db:generate` and review the migration.

SQLite and artifacts persist in `.data/onboarding` (override `SCRAPER_DATA_DIR`).
Back up the complete directory with the app stopped or a SQLite-aware backup tool.
Runtime images receive content-derived `bid-desk-runtime` tags; retain those tags
while their packages are in use. Interrupted jobs require explicit retry after
restart; jobs continue across browser refreshes. Available record checkpoints
remain downloadable after failed or cancelled runs and are labelled partial.
Empty manual runs are allowed, but empty validation samples cannot be approved.

The worker supports HTTP, Cheerio, Playwright, and mixed routes. Generated code
runs as a non-root user in disposable, resource-limited containers with no network
interface, host secrets, or Docker socket. A separate trusted gateway exposes a
domain-filtered public-address proxy over a shared Unix socket. Apify's
`proxy-chain` owns HTTP forwarding, HTTPS tunnels, and connection cleanup;
`runner/proxy-policy.ts` contains our domain/port checks and DNS address pinning.
The gateway enforces a 30-second idle timeout and monitors a 100 MiB per-run
traffic budget using library counters every 100 ms (brief overshoot is possible).
Both HTTP and
browser traffic use this path; redirects cannot bypass connection-time address
checks. Fixture tests have no gateway. Source domains must include any essential
public asset/API hosts; HTTP port 80 and HTTPS port 443 are supported.

Default limits: 20 agent steps and three repairs; previews of up to 50 pages and
200 raw records (20 valid records shown); manual runs of up to 1,000 pages and
10,000 raw records. Preview execution is limited to 10 minutes, manual execution
to 30 minutes. One job runs at a time. Budget-limited results describe incomplete
coverage. Missing bid facts remain null and uncertain deadlines/statuses surface
as warnings. Attachments are linked, not parsed.

The target is self-hosted Crawlee/Playwright, with no Browserbase dependency.
The browser session controller already gates agent/human ownership. Live JPEG
screencasting, app WebSockets, canvas input, popups, and human login/CAPTCHA
takeover are the next stage in [the revised plan](docs/source-onboarding-plan.md).
This version reports those barriers rather than solving them.

### Reproduce the onboarding flow without model credentials

```sh
bun run runner:build
bun run runner:test   # real isolated crawlers against deterministic fixture sites
bun run build
PORT=3088 bun run demo:sources
```

Open `http://localhost:3088/sources`, create a source using
`http://fixture.test/rendered`, and choose **Investigate & generate**. The demo uses
real Playwright and Cheerio workers against a fixture site and a scripted model;
it does not demonstrate real-model extraction quality. It stores data in a separate
temporary directory, printed at startup. Set `DEMO_DATA_DIR` to reuse that directory
across restarts. Fixture networking is never enabled by production APIs.

To execute an exported package from this repository:

```sh
bun run scraper:run /absolute/path/to/extracted-package
```

This runs offline package tests and then a bounded isolated crawl. The package's
pinned image must exist locally. Production startup needs the `runner/` assets
beside the application (or `SCRAPER_RUNTIME_DIR`), the `drizzle/` migration directory
(or `SCRAPER_MIGRATIONS_DIR`), and the built image. Dockerode connects through the
standard Docker socket or Docker Desktop socket; set `DOCKER_HOST` for another
engine. Docker CLI contexts are not automatically selected by the SDK.

This is a single-operator workspace without accounts. Production listens on
`127.0.0.1` by default; configure `HOST` and `SCRAPER_APP_ORIGIN` only behind your
own authenticated reverse proxy for remote access.

## Library ownership

- Effect Queue, fibers, Deferred, and ManagedRuntime own background job lifetimes;
  SQLite retains job state. Restarted jobs remain interrupted until explicitly retried.
- Effect AI structured output validates model decisions against the shared schema.
- Effect HttpApi and AtomHttpApi generate the command/query protocol at
  `/api/source-data/*`; Effect streams and native EventSource handle progress replay.
- Effect Atom owns query state and invalidation; TanStack Router owns source URLs;
  Base UI Tabs supplies review-panel keyboard navigation and accessibility.
- Drizzle ORM/Kit owns database queries, transactions, JSON columns, and migrations.
- Dockerode owns container/image/volume operations and stream demultiplexing.
- Crawlee RequestQueue owns request deduplication; Effect Semaphore owns browser input
  serialization, request admission, and shared per-host concurrency permits.
  Effect Latch and Deferred coordinate browser pause/resume and session closure.
  Shared admission and host limits span all strategy instances; Crawlee's own
  concurrency and rate limits remain responsible for each individual crawler.
- Bun.Archive creates package downloads; csv-stringify produces CSV with formula
  escaping. Node's test runner supplies structured fixture-test outcomes.

Source policy, evidence checks, version approval, and restricted network access
remain application responsibilities. The worker stays on Crawlee/Playwright with
bundled Chromium; live screencasting and browser takeover remain stage 2.

## Run locally

```sh
bun install
cp .env.example .env
# Set OPENROUTER_API_KEY in .env; select a model supporting function/tool calls.
bun run dev
```

Open http://localhost:3000 and ask:

> Scrape https://example.com and summarize it.

The model calls `scrapeUrl`, receives the title and extracted text, then streams
an answer with a source link. The existing loading indicator stays active during
scraping. Stop cancels the model stream and any active scrape.

For a key-free chat demonstration, run `bun run mock` in one terminal and
`bun run dev:mock` in another. The mock recognizes a request to “scrape” or “read”
an HTTP(S) URL and prints the actual scraper result in its response.

## Scrape without a model

```sh
bun run scrape:example https://example.com
```

This prints `{ url, finalUrl, title, text, truncated }` as JSON and requires no
OpenRouter key. `Scraper.scrape({ url })` is the reusable Effect entry point;
provide `Scraper.layer` to use the real implementation or a fake layer in tests.

## Self-hosting

```sh
bun run build
# Supply OPENROUTER_API_KEY and optionally OPENROUTER_MODEL in the environment.
bun run start
```

The Bun server listens on `PORT` (default 3000). For the original single-page chat
tool, Crawlee 3.18.1 runs inside that process; no Apify account, browser
installation, database, or worker is needed. Source onboarding uses the persistent
storage and isolated workers described above.
Scraping requires outbound DNS and HTTP(S) connectivity. Each invocation uses
isolated memory storage and discards its queue when complete. There is no crawl
history or persistence for this single-page tool. Tool details remain within the current chat request;
later turns receive the existing user/assistant text history.

The scraper reads one HTML page with Cheerio, without executing JavaScript or
following links. It prefers `main`, then `article`, then `body`, removes common
non-content elements, and caps extracted text at 20,000 characters. It allows
one retry within a 30-second operation timeout, limits the decompressed response
to 5 MiB, and allows at most five redirects. Cleanup is awaited on cancellation
and timeout. HTTP errors and non-HTML pages become typed `ScrapeError` results.

Only public HTTP(S) URLs without credentials are allowed. Redirect URLs and
addresses supplied by DNS to the actual socket are checked; local, private,
reserved, and IPv4-mapped private addresses are rejected. The transport disables
HTTP/2, DNS caching, and proxy configuration to keep connections on that checked
path. Site-specific extraction, rendered pages, and multi-page crawls are handled
in the separate source workspace.

## Checks

```sh
bun run typecheck
bun run lint:effect
bun run test
bun run build
bun run runner:test # after runner:build; requires Docker
```

Tests use fixture transports and fake model layers, without external requests.
The timeout test intentionally takes 30 seconds. To smoke-test real networking,
run the standalone example, then the scrape prompt with the local mock provider.
