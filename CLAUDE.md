# Bid Desk Chat

Streaming chat and source onboarding: Bun + TypeScript 7 + TanStack Start (React 19) + Effect v4 + Effect Atom + shadcn/ui, OpenRouter as the model provider. Ordinary chat is ephemeral; sources, packages, approvals, and jobs persist in SQLite.

## Commands

| command | purpose |
|---|---|
| `bun install` | installs deps and runs `effect-tsgo patch` (see TS 7 notes) |
| `bun run dev` | Vite dev server on :3000 (regenerates `src/routeTree.gen.ts`) |
| `bun run typecheck` | `tsc --noEmit` with the native TS 7 compiler, Effect diagnostics included |
| `bun run lint:effect` | Effect language-service diagnostics only |
| `bun run test` | vitest (`src/**/*.test.ts`, node env, uses `vitest.config.ts` so the Start plugin never loads) |
| `bun run build && bun run start` | production build + Bun server (`server.ts`) |
| `bun run ui:add <component>` | add a shadcn component (`bunx --bun shadcn@latest add`) |
| `bun run mock` + `bun run dev:mock` | key-less local dev: a mock OpenAI-compatible SSE provider on :4010 (`scripts/mock-openrouter.ts`) and the app pointed at it via `OPENROUTER_API_URL` |

Env: copy `.env.example` to `.env` (`OPENROUTER_API_KEY` required; `OPENROUTER_MODEL`, `OPENROUTER_API_URL`, `OPENROUTER_SITE_URL`, `OPENROUTER_SITE_TITLE` optional). Server code reads unprefixed `process.env` vars (Start loads `.env`); only `VITE_`-prefixed vars reach the client.

## Effect conventions (effect.solutions, Effect v4)

- **All Effect packages pinned to the same RC build** (`4.0.0-rc.113`), including the standalone runner. Bump them together. RCs drift; keep app Effect imports inside `src/server`, `src/atoms`, `src/domain`; the standalone runner and CLI also use Effect for validation and concurrency.
- Follow `AGENTS.md`: prefer Effect primitives before custom infrastructure or overlapping dependencies. Model data with Effect Schema, derive TypeScript types, and decode untrusted boundary data. Shared runner/package schemas live in `runner/contract.ts`; ordinary interfaces are reserved for behavioral ports and other documented exceptions.
- Services: `class X extends Context.Service<X, Shape>()("@app/X")` with a `static readonly layer`. Capture dependencies at layer build time so service methods have `R = never` (see `ChatService`).
- Errors: `class E extends Schema.TaggedError<E>()("E", { ... }) {}`. Map provider errors at the boundary (`Stream.mapError`) rather than leaking `AiError`.
- Domain schemas live in `src/domain/Chat.ts`; use `Schema.Literals`, `Schema.TaggedStruct`, `Schema.Union([...])`, `Schema.fromJsonString` for wire codecs.
- Layers are provided once per entry point: `src/server/Layers.ts` -> `ServerRuntime` (ManagedRuntime singleton on `globalThis` so Vite HMR keeps it), `src/atoms/runtime.ts` -> `Atom.runtime` for the browser.
- v4 renames to remember: `Effect.catch` (not `catchAll`), `Effect.callback` (not `async`), `Config.String` / `Config.Redacted` (capitalised), `Stream.succeed` for a single value (`Stream.make` is variadic), `Layer.unwrap` for config-dependent layers.
- `Stream.scan` emits its seed only when the first upstream chunk arrives. `sendMessageAtom` therefore prepends an explicit first emission so an instant provider failure still leaves the user message in place.
- Tests use `@effect/vitest` (`it.effect`) with fake layers (`Layer.effect(LanguageModel.LanguageModel, LanguageModel.make({...}))`).
- Local Effect source clone for reference: `~/.local/share/effect-solutions/effect` (run `git pull` there so it matches the pinned RC before relying on it).

## Architecture

- Source onboarding: `/sources` uses the shared Effect HttpApi at `/api/source-data/*`, `/api/sources` for artifact downloads, and `/api/source-events` for replayable SSE. `src/atoms/sources.ts` uses AtomHttpApi for query/mutation state; source selection belongs to TanStack Router. `src/server/onboarding` uses Drizzle SQLite with migrations in `drizzle/`, Effect Queue/fibers for jobs, structured Effect AI decisions, and package validation. Use `bun run db:generate` after editing `db/schema.ts`. Browser disconnects do not cancel source jobs; explicit cancellation does.
- `runner/` is a separate pinned Node/Crawlee/Playwright Docker runtime. Generated code is never imported by the app server. Network-disabled workers reach a public-address-filtered proxy through a Unix socket shared with a trusted gateway container. `runtime.json` pins each package to an image retained under a content-derived tag.
- `runner/session.ts` gates browser actions by ownership using Effect Semaphore, Latch, and Deferred. Apify's `proxy-chain` owns gateway forwarding/tunneling; `runner/proxy-policy.ts` owns destination restrictions and DNS pinning, and `proxy-traffic.ts` monitors library byte counters. Do not reimplement proxy transport. Dockerode owns container lifecycle; Bun.Archive and csv-stringify own downloads. Live screencasting and human takeover are stage 2; do not add Browserbase or expose CDP. See `docs/source-onboarding-plan.md`.
- `bun run runner:build` builds Chromium and dependencies; `bun run runner:test` exercises real isolated crawlers on fixture websites. `bun run demo:sources` starts a separate, key-free fixture app after a production build. Production code never enables fixture networking.

- `POST /api/chat` (`src/routes/api/chat.ts`) validates `ChatRequest`, runs `ChatService.stream`, and returns SSE via `src/server/Sse.ts`. Provider failures become a terminal `{"_tag":"Error"}` event, never a mid-stream 500. `GET /api/chat` returns `{ model }`.
- `src/server/ChatService.ts#partToEvents` maps provider stream parts to wire events. `ScrapeToolkit` provides `scrapeUrl`; request-local history carries tool results into one final model call with tool execution disabled. Tool calls/results remain server-side; SSE still uses TextDelta/Error/Done.
- `Scraper` wraps Crawlee's CheerioCrawler with isolated in-memory storage, scoped cleanup, and a 30-second deadline. `ScrapeHttpClient` enforces public URLs, connection-time DNS checks, redirects, HTML content type, and a 5 MiB body limit. See README for the standalone example and self-hosting commands.
- Client: `ChatClient` (Effect HttpClient over fetch, hand-rolled SSE decode) -> `sendMessageAtom` (`runtime.fn`, emits the full message list per token) -> `messagesAtom` / `isGeneratingAtom` / `chatFailureAtom` derived views. Stop = write `Atom.Interrupt`, Retry = write `Regenerate`, New chat = write `Atom.Reset`.
- Theme: `themeAtom` (`Atom.kvs` over localStorage, JSON encoded) + `ThemeEffect` + a no-flash inline script in `__root.tsx`.
- `src/routes/index.tsx` has `ssr: false`; the root shell still SSRs.

## TypeScript 7 + @effect/tsgo

- TS 7 is the native compiler; classic tsserver plugins do not load. `@effect/tsgo` swaps the native `tsc` binary for the Effect team's build so both `tsc` and the editor emit Effect diagnostics. `bun install` runs `effect-tsgo patch` via `prepare`; `bunx effect-tsgo unpatch` restores. `@effect/tsgo@0.45.0` supports exactly `typescript@7.0.2`; bump both together.
- tsconfig: no `baseUrl` (removed in TS 7), `paths` relative to root, `types` listed explicitly, `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` on. Watch for `exactOptionalPropertyTypes` when passing optional props to third-party components (spread a conditional object instead of `prop={x ?? undefined}`).
- `.vscode/settings.json` points VS Code at the workspace TS and enables tsgo.

## shadcn/ui

- Style `base-nova` (Base UI primitives, Lucide, Geist). Triggers use Base UI's `render={<Button .../>}` prop, not `asChild`.
- Add components with `bun run ui:add <name>`; do not hand-edit `src/components/ui/*` without a reason (note it here if you do).
- `src/styles.css` holds the shadcn theme plus `@source` lines so Tailwind scans `streamdown` and `@streamdown/code` classnames, and `.chat-prose` tweaks for assistant markdown.
- Markdown rendering uses `streamdown` (streaming-aware) with the `@streamdown/code` Shiki plugin. Drop the plugin if client bundle size matters more than highlighted code.
