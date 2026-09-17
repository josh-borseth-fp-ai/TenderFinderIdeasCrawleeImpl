import { Context, Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import {
  type ChatEvent,
  ChatInfo,
  decodeChatEvent,
  SavedChatRequest,
} from "@/domain/Chat"

export class ChatClientError extends Schema.TaggedError<ChatClientError>()("ChatClientError", {
  message: Schema.String,
}) {}

const toClientError = (e: { readonly message: string }) => new ChatClientError({ message: e.message })

interface Shape {
  readonly send: (request: SavedChatRequest) => Stream.Stream<ChatEvent, ChatClientError>
  readonly info: Effect.Effect<ChatInfo, ChatClientError>
}

/** Browser-side client for the same-origin /api/chat route. */
export class ChatClient extends Context.Service<ChatClient, Shape>()("@app/ChatClient") {
  static readonly layer = Layer.effect(
    ChatClient,
    Effect.gen(function* () {
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

      const send: Shape["send"] = (request) =>
        HttpClientRequest.post("/api/chat").pipe(
          HttpClientRequest.bodyJsonUnsafe(Schema.encodeSync(SavedChatRequest)(request)),
          http.execute,
          HttpClientResponse.stream,
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.startsWith("data:")),
          Stream.map((line) => line.slice("data:".length).trimStart()),
          Stream.mapEffect((data) => decodeChatEvent(data)),
          Stream.mapError(toClientError),
        )

      const info: Shape["info"] = http.get("/api/chat").pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ChatInfo)),
        Effect.mapError(toClientError),
      )

      return ChatClient.of({ send, info })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
