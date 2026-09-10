import { Config, Context, Effect, Layer, Option, Redacted } from "effect"

interface Shape {
  readonly apiKey: Redacted.Redacted<string>
  readonly model: string
  /** Override the OpenRouter base URL (proxies, local mocks). */
  readonly apiUrl: Option.Option<string>
  readonly siteUrl: Option.Option<string>
  readonly siteTitle: Option.Option<string>
}

export class AppConfig extends Context.Service<AppConfig, Shape>()("@app/AppConfig") {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const apiKey = yield* Config.Redacted("OPENROUTER_API_KEY")
      const model = yield* Config.String("OPENROUTER_MODEL").pipe(Config.withDefault("openai/gpt-4o-mini"))
      const apiUrl = yield* Config.option(Config.String("OPENROUTER_API_URL"))
      const siteUrl = yield* Config.option(Config.String("OPENROUTER_SITE_URL"))
      const siteTitle = yield* Config.option(Config.String("OPENROUTER_SITE_TITLE"))
      return AppConfig.of({ apiKey, model, apiUrl, siteUrl, siteTitle })
    }),
  )
}
