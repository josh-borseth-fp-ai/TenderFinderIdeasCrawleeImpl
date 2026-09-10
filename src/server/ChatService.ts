import { Context, Effect, Layer, Schema, Stream } from "effect"
import { LanguageModel, type Prompt, type Response } from "effect/unstable/ai"
import type { ChatEvent, ChatMessage } from "@/domain/Chat"

export class ChatError extends Schema.TaggedError<ChatError>()("ChatError", {
  message: Schema.String,
}) {}

export const SYSTEM_PROMPT =
  "You are a concise, helpful assistant. Use Markdown for structure: short paragraphs, lists when enumerating, and fenced code blocks with a language tag for code."

/** Single seam mapping provider stream parts to wire events. Tool parts get cases here later. */
export const partToEvents = (part: Response.StreamPart<{}>): ReadonlyArray<ChatEvent> => {
  switch (part.type) {
    case "text-delta":
      // Providers often open with an empty content chunk; skip it.
      return part.delta.length > 0 ? [{ _tag: "TextDelta", delta: part.delta }] : []
    case "error":
      return [{ _tag: "Error", message: describeUnknown(part.error) }]
    default:
      return []
  }
}

const describeUnknown = (u: unknown): string =>
  u instanceof Error ? u.message : typeof u === "string" ? u : "Unknown provider error"

const toPrompt = (messages: ReadonlyArray<ChatMessage>): Prompt.RawInput => [
  { role: "system", content: SYSTEM_PROMPT },
  ...messages.map((m): Prompt.MessageEncoded => ({ role: m.role, content: m.content })),
]

interface Shape {
  readonly stream: (messages: ReadonlyArray<ChatMessage>) => Stream.Stream<ChatEvent, ChatError>
}

export class ChatService extends Context.Service<ChatService, Shape>()("@app/ChatService") {
  static readonly layer = Layer.effect(
    ChatService,
    Effect.gen(function* () {
      // Captured at build time so the service methods have R = never.
      const model = yield* LanguageModel.LanguageModel
      return ChatService.of({
        stream: (messages) =>
          model.streamText({ prompt: toPrompt(messages) }).pipe(
            Stream.flatMap((part) => Stream.fromIterable(partToEvents(part))),
            Stream.concat(Stream.succeed<ChatEvent>({ _tag: "Done" })),
            Stream.mapError((e) => new ChatError({ message: e.message })),
          ),
      })
    }),
  )
}
