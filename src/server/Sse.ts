import { Effect, Stream } from "effect"
import { Sse } from "effect/unstable/encoding"
import { type ChatEvent, encodeChatEvent } from "@/domain/Chat"
import type { ChatError } from "./ChatService.ts"

const abortSignal = (signal: AbortSignal): Effect.Effect<void> =>
  signal.aborted
    ? Effect.void
    : Stream.fromEventListener(signal, "abort").pipe(Stream.take(1), Stream.runDrain)

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const

/**
 * Turns a ChatEvent stream into an SSE Response.
 * Provider errors become a terminal `Error` event (never a mid-stream 500);
 * client disconnects interrupt the upstream stream.
 */
export const toSseResponse = <R>(
  events: Stream.Stream<ChatEvent, ChatError, R>,
  signal: AbortSignal,
): Effect.Effect<Response, never, R> =>
  events.pipe(
    Stream.catchTag("ChatError", (e) => Stream.succeed<ChatEvent>({ _tag: "Error", message: e.message })),
    Stream.map((event) =>
      Sse.encoder.write({ _tag: "Event", event: "message", id: undefined, data: encodeChatEvent(event) }),
    ),
    Stream.encodeText,
    Stream.interruptWhen(abortSignal(signal)),
    Stream.ensuring(Effect.logDebug("sse stream closed")),
    Stream.toReadableStreamEffect(),
    Effect.map((body) => new Response(body, { headers: SSE_HEADERS })),
  )
