import { Schema } from "effect"

export const ChatRole = Schema.Literals(["user", "assistant"])
export type ChatRole = typeof ChatRole.Type

export const ChatMessage = Schema.Struct({
  role: ChatRole,
  content: Schema.String,
})
export type ChatMessage = typeof ChatMessage.Type

export const ChatRequest = Schema.Struct({
  messages: Schema.Array(ChatMessage),
})
export type ChatRequest = typeof ChatRequest.Type

export const ChatInfo = Schema.Struct({
  model: Schema.String,
})
export type ChatInfo = typeof ChatInfo.Type

export const TextDelta = Schema.TaggedStruct("TextDelta", { delta: Schema.String })
export const Done = Schema.TaggedStruct("Done", {})
export const ErrorEvent = Schema.TaggedStruct("Error", { message: Schema.String })

/** Wire events streamed from POST /api/chat. Tool events become new members here. */
export const ChatEvent = Schema.Union([TextDelta, Done, ErrorEvent])
export type ChatEvent = typeof ChatEvent.Type

/** string <-> ChatEvent codec used on both sides of the SSE channel */
export const ChatEventJson = Schema.fromJsonString(ChatEvent)

export const encodeChatEvent = Schema.encodeSync(ChatEventJson)
export const decodeChatEvent = Schema.decodeUnknownEffect(ChatEventJson)
export const decodeChatRequest = Schema.decodeUnknownExit(ChatRequest)
export const encodeChatRequest = Schema.encodeSync(ChatRequest)
