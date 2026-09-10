import { createFileRoute } from "@tanstack/react-router"
import { Effect, Exit } from "effect"
import { decodeChatRequest } from "@/domain/Chat"
import { AppConfig } from "@/server/AppConfig"
import { ChatService } from "@/server/ChatService"
import { ServerRuntime } from "@/server/ServerRuntime"
import { toSseResponse } from "@/server/Sse"

const badRequest = (message: string) =>
  Response.json({ error: message }, { status: 400 })

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: () =>
        ServerRuntime.runPromise(
          Effect.map(AppConfig, (config) => Response.json({ model: config.model })),
        ),

      POST: async ({ request }) => {
        const body: unknown = await request.json().catch(() => undefined)
        if (body === undefined) return badRequest("Body must be JSON")

        const decoded = decodeChatRequest(body)
        if (Exit.isFailure(decoded)) {
          return badRequest("Invalid chat request: expected { messages: Array<{ role: \"user\" | \"assistant\", content: string }> }")
        }

        return ServerRuntime.runPromise(
          Effect.gen(function* () {
            const chat = yield* ChatService
            return yield* toSseResponse(chat.stream(decoded.value.messages), request.signal)
          }),
        )
      },
    },
  },
})
