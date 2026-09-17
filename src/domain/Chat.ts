import { Schema } from "effect"

export const ChatRole = Schema.Literals(["user", "assistant"])
export type ChatRole = typeof ChatRole.Type

export const ChatMessage = Schema.Struct({
  role: ChatRole,
  content: Schema.String,
})
export type ChatMessage = typeof ChatMessage.Type

export const MessageStatus = Schema.Literals(["streaming", "interrupted", "error"])
export type MessageStatus = typeof MessageStatus.Type
export const UiMessage = Schema.Struct({ ...ChatMessage.fields, id: Schema.optional(Schema.String), sourceIds: Schema.optional(Schema.Array(Schema.String)), status: Schema.optional(MessageStatus) })
export type UiMessage = typeof UiMessage.Type
export const ChatFailure = Schema.Struct({ kind: Schema.Literals(["interrupted", "error"]), message: Schema.String })
export type ChatFailure = typeof ChatFailure.Type

export const ChatRequest = Schema.Struct({
  messages: Schema.Array(ChatMessage),
})
export type ChatRequest = typeof ChatRequest.Type

export const SavedChatRequest = Schema.Struct({ conversationId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)), turnId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)), content: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10000)), sourceId: Schema.optional(Schema.String) })
export type SavedChatRequest = typeof SavedChatRequest.Type
export const MessageEvent = Schema.TaggedStruct("Message", { id: Schema.String, sourceIds: Schema.Array(Schema.String) })

export const ChatInfo = Schema.Struct({
  model: Schema.String,
})
export type ChatInfo = typeof ChatInfo.Type

export const TextDelta = Schema.TaggedStruct("TextDelta", { delta: Schema.String })
export const Done = Schema.TaggedStruct("Done", {})
export const ErrorEvent = Schema.TaggedStruct("Error", { message: Schema.String })

/** Wire events streamed from POST /api/chat. Tool events become new members here. */
export const ChatEvent = Schema.Union([TextDelta, Done, ErrorEvent, MessageEvent])
export type ChatEvent = typeof ChatEvent.Type

/** string <-> ChatEvent codec used on both sides of the SSE channel */
export const ChatEventJson = Schema.fromJsonString(ChatEvent)

export const encodeChatEvent = Schema.encodeSync(ChatEventJson)
export const decodeChatEvent = Schema.decodeUnknownEffect(ChatEventJson)
export const decodeChatRequest = Schema.decodeUnknownExit(ChatRequest)
export const encodeChatRequest = Schema.encodeSync(ChatRequest)
