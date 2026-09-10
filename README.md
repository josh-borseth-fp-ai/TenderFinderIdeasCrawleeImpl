# Bid Desk Chat

TypeScript chat with Effect v4, OpenRouter, and self-hosted Crawlee scraping.

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

The Bun server listens on `PORT` (default 3000). Crawlee 3.18.1 runs inside that
process; no Apify account, browser installation, database, or worker is needed.
Scraping requires outbound DNS and HTTP(S) connectivity. Each invocation uses
isolated memory storage and discards its queue when complete. There is no crawl
history or persistence. Tool details remain within the current chat request;
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
path. Site-specific extraction, rendered pages, recursive crawls, and background
jobs are outside this initial implementation.

## Checks

```sh
bun run typecheck
bun run lint:effect
bun run test
bun run build
```

Tests use fixture transports and fake model layers, without external requests.
The timeout test intentionally takes 30 seconds. To smoke-test real networking,
run the standalone example, then the scrape prompt with the local mock provider.
