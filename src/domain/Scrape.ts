import { Schema } from "effect"

export const ScrapeResult = Schema.Struct({
  url: Schema.String,
  finalUrl: Schema.String,
  title: Schema.String,
  text: Schema.String,
  truncated: Schema.Boolean,
})
export type ScrapeResult = typeof ScrapeResult.Type

export class ScrapeError extends Schema.TaggedError<ScrapeError>()("ScrapeError", {
  message: Schema.String,
}) {}
