# Bid Desk Chat

TypeScript chat with Effect v4, OpenRouter, and self-hosted Crawlee scraping.

## Discover opportunities in chat

Paste a public website URL into the main chat. The agent discovers its procurement
pages, chooses the scraping strategy, builds and validates a scraper, and collects
all reachable opportunities in scope. Technical source configuration and internal
validation stay behind the conversation. Current opportunities are the default;
change what to find by replying in the same chat.

```sh
bun install
bun run runner:build # Docker required; includes Playwright 1.59.1 Chromium
bun run dev         # OPENROUTER_API_KEY required for real discovery
```

Results appear inline while collection runs, with 50 opportunities per page,
expandable details, source links, and a CSV export of the collected dataset.
Incomplete collections stay visibly incomplete. **Continue collection** retries
unfinished work without deleting already collected records.

After collection, **Save this source** confirms the exact validated scraper for
future **Check again** requests; saving does not run it again. A replacement scraper
collects its results before asking for confirmation. Ordinary chat, saved conversation
history, and multiple sources in one conversation share one composer. `/sources`
links redirect into chat.

Generated packages contain `SCRAPER.md`, `scraper.ts`, `scraper.test.ts`,
`contract.ts`, captured fixtures, the source brief, an execution manifest, pinned
dependencies/lockfile, and the runtime image identity. The generated module exports
`extract` and `discover`; optional `browsePages` uses gated browser actions and
persisted cursors for rendered pagination. The runner owns Crawlee queues, network policy, and browser lifecycle.

Drizzle manages SQLite queries and versioned migrations in `drizzle/`; startup applies
pending migrations and preserves databases created by the initial onboarding version.
After changing the database schema, run `bun run db:generate` and review the migration.

Conversations, source links, collection snapshots, and individual records live in
SQLite. Crawlee queue storage persists per collection alongside the artifacts.
Workers persist record chunks before advancing requests or browser cursors; the
app replays interrupted deliveries into SQLite and deduplicates by stable record ID.
Existing source messages and legacy run results migrate on startup; legacy coverage
remains explicitly partial. Old exported packages retain their pinned runtime and
contract; the app regenerates a legacy scraper before a resumable full collection.

SQLite and artifacts persist in `.data/onboarding` (override `SCRAPER_DATA_DIR`).
Back up the complete directory with the app stopped or a SQLite-aware backup tool.
Runtime images receive content-derived `bid-desk-runtime` tags; retain those tags
while their packages are in use. Interrupted jobs can be continued after
restart; jobs continue across browser refreshes. Collected records remain available
after failed or cancelled runs and are labelled partial.
Empty collections are supported. Initial empty validation requires observed
zero-total evidence and passing fixture tests; an extraction failure is not an empty result.

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
checks. Fixture tests have no gateway. The agent adds essential public asset/API hosts only when observed during discovery; HTTP port 80 and HTTPS port 443 are supported.

Discovery retains its 20-step and three-repair budgets. Internal validation uses
up to 50 pages and 200 raw records. Full collection runs in batches of up to 1,000
pages, 10,000 records, and 30 minutes; a page's records are not sliced at the record
boundary. Crawlee queues and browser cursors persist, and batches continue automatically
until traversal is exhausted. Per-batch limits protect resources rather than cap the
complete dataset. Failed pages, robots exclusions, mismatched totals, cancellation, and
resource failures prevent a false completion claim. One job runs at a time.
Missing facts remain null. Attachments are linked, not parsed.

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

Open `http://localhost:3088/` and paste `http://fixture.test/rendered` into chat.
Wait for all opportunities, then choose **Save this source**. To exercise pagination
and collection beyond 10,000 records, use `http://fixture.test/many` in another chat. The demo uses
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
- Effect Atom owns query state, invalidation, and scoped reconciliation; TanStack
  Router owns saved conversation URLs. Source SSE refreshes inline result cards.
- Drizzle ORM/Kit owns database queries, transactions, JSON columns, and migrations.
- Dockerode owns container/image/volume operations and stream demultiplexing.
- Crawlee RequestQueue owns request deduplication; Effect Semaphore owns browser input
  serialization, request admission, and shared per-host concurrency permits.
  Effect Latch and Deferred coordinate browser pause/resume and session closure.
  Shared admission and host limits span all strategy instances; Crawlee's own
  concurrency and rate limits remain responsible for each individual crawler.
- Handlebars renders the runbook from `runner/SCRAPER.md.hbs`; Effect Schema
  validates package drafts. Runtime versions and execution limits feed the template
  from the pinned runner package and shared contract.
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
through the source discovery flow in the main chat.

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
