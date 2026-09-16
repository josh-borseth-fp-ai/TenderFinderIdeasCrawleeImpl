import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { AppConfig } from "./AppConfig.ts"
import { ChatService } from "./ChatService.ts"
import { Scraper } from "./Scraper.ts"
import { SourceModel } from "./onboarding/SourceModel.ts"

const OpenRouterLive = Layer.unwrap(
  Effect.map(AppConfig, (config) =>
    OpenRouterLanguageModel.layer({ model: config.model }).pipe(
      Layer.provide(
        OpenRouterClient.layer({
          apiKey: config.apiKey,
          apiUrl: Option.getOrUndefined(config.apiUrl),
          siteReferrer: Option.getOrUndefined(config.siteUrl),
          siteTitle: Option.getOrUndefined(config.siteTitle),
        }),
      ),
    ),
  ),
).pipe(Layer.provide(FetchHttpClient.layer))

/** Everything the API routes need: ChatService plus AppConfig for the info endpoint. */
export const appLayer = Layer.mergeAll(ChatService.layer, SourceModel.layer).pipe(
  Layer.provide(Scraper.layer),
  Layer.provide(OpenRouterLive),
  Layer.provideMerge(AppConfig.layer),
)
