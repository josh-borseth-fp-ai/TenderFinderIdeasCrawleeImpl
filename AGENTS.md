# Repository instructions

Read `CLAUDE.md` for architecture, commands, and Effect conventions.

## Model data with Effect Schema

- Define application data with Effect Schema first, rather than handwritten TypeScript interfaces or object/union aliases. This includes domain records, statuses, API messages, persisted payloads, configuration data, and runner/package protocols.
- Derive types from the schema (`export type X = typeof X.Type`). Use `Schema.Struct` for plain data, `Schema.Class` when a model needs behavior, `Schema.Literals`/`Schema.Union` for alternatives, and `Schema.TaggedError` for domain errors. Reuse schemas and their fields instead of duplicating shapes. Add refinements and brands when they enforce meaningful invariants.
- Decode untrusted data at boundaries: HTTP/SSE, model responses, CLI arguments, files/database JSON, and worker messages. Prefer `Schema.fromJsonString` to `JSON.parse(...) as SomeType`; a cast is not validation. Keep wire encoding compatible with existing persisted data and package versions.
- Ordinary TypeScript types remain appropriate for behavioral service ports, functions/callbacks, runtime handles (such as AbortSignal or Playwright pages), generics, React props, and third-party/generated types. Do not invent schemas for executable capabilities or hand-edit generated files.
- Keep app schemas in `src/domain`. Shared standalone runner/package schemas live in `runner/contract.ts`, which must ship in generated packages. Pin the runner's Effect dependency to the exact same version as the app. UI components should consume schema-derived types without importing Effect directly.
- Follow [Effect Solutions: Data Modeling](https://www.effect.solutions/data-modeling), adapting examples to the repository's pinned Effect v4 APIs. Verify those APIs against installed typings; do not copy examples for a different Effect release blindly.

## Validation and PRs

Run the checks in `CLAUDE.md`; include `bun run runner:build` and `bun run runner:test` when changing runner contracts, dependencies, or execution. Add regression coverage for rejected boundary data and preserved valid behavior.

When creating or updating a GitHub PR as authorized work, follow `/Users/joshuaborseth/.codex/skills/maintain-pr/SKILL.md` through review and CI. This does not authorize merging, deployment, or background automation.
