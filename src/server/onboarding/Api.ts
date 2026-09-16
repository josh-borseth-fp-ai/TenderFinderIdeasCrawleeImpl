import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SourceApi } from "../../domain/SourceApi.ts"
import { SourceError } from "../../domain/Source.ts"
import { onboarding } from "./Runtime.ts"
import { checkSourceRequest } from "./Http.ts"

const failure = (error: unknown) => new SourceError({ message: error instanceof Error ? error.message : String(error) })
const handlers = HttpApiBuilder.group(SourceApi, "sources", (handler) => handler
  .handle("list", () => Effect.tryPromise({ try: async () => (await onboarding()).list(), catch: failure }))
  .handle("detail", ({ params }) => Effect.tryPromise({ try: async () => (await onboarding()).detail(params.id), catch: failure }))
  .handle("files", ({ params }) => Effect.tryPromise({ try: async () => { const service = await onboarding(); return service.files(service.store.version(params.id)) }, catch: failure }))
  .handle("command", ({ payload }) => Effect.tryPromise({ try: async () => (await onboarding()).command(payload.command), catch: failure })),
)
const api = HttpRouter.toWebHandler(HttpApiBuilder.layer(SourceApi).pipe(Layer.provide(handlers), Layer.provide(HttpServer.layerServices)), { disableLogger: true })

export async function sourceDataApi(request: Request): Promise<Response> {
  const rejected = await checkSourceRequest(request)
  return rejected ?? api.handler(request)
}
