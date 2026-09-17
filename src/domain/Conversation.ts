import { Schema } from "effect"
import { ChatMessage } from "./Chat.ts"
import { BidRecord, Job, Source } from "./Source.ts"

export const Conversation = Schema.Struct({ id: Schema.String, title: Schema.String, createdAt: Schema.String, updatedAt: Schema.String })
export type Conversation = typeof Conversation.Type
export const SavedMessage = Schema.Struct({ id: Schema.String, conversationId: Schema.String, role: Schema.Literals(["user", "assistant"]), content: Schema.String, sourceIds: Schema.Array(Schema.String), status: Schema.Literals(["complete", "streaming", "interrupted", "error"]), createdAt: Schema.String })
export type SavedMessage = typeof SavedMessage.Type
export const Collection = Schema.Struct({ id: Schema.String, sourceId: Schema.String, versionId: Schema.String, state: Schema.Literals(["running", "complete", "partial"]), count: Schema.Int, visitedCount: Schema.Int, coverage: Schema.String, createdAt: Schema.String, updatedAt: Schema.String })
export type Collection = typeof Collection.Type
export const SourceCard = Schema.Struct({ source: Source, job: Schema.NullOr(Job), collection: Schema.NullOr(Collection) })
export type SourceCard = typeof SourceCard.Type
export const ConversationDetail = Schema.Struct({ conversation: Conversation, messages: Schema.Array(SavedMessage), sources: Schema.Array(SourceCard) })
export type ConversationDetail = typeof ConversationDetail.Type
export const ResultPage = Schema.Struct({ collection: Collection, page: Schema.Int, pageSize: Schema.Literal(50), records: Schema.Array(BidRecord) })
export type ResultPage = typeof ResultPage.Type
export const ConversationAction = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  conversationId: Schema.String,
  action: Schema.Literals(["save", "refresh", "continue", "stop", "open"]),
  sourceId: Schema.String,
  collectionId: Schema.optional(Schema.String),
})
export type ConversationAction = typeof ConversationAction.Type
export const SourceIntent = Schema.Union([
  Schema.Struct({ action: Schema.Literal("chat") }),
  Schema.Struct({ action: Schema.Literal("question"), message: Schema.String }),
  Schema.Struct({ action: Schema.Literal("sources") }),
  Schema.Struct({ action: Schema.Literal("discover"), url: Schema.String, guidance: Schema.String }),
  Schema.Struct({ action: Schema.Literal("operate"), sourceId: Schema.String, operation: Schema.Literals(["refresh", "continue", "stop", "open"]) }),
  Schema.Struct({ action: Schema.Literal("refine"), sourceId: Schema.String, guidance: Schema.String, openOnly: Schema.NullOr(Schema.Boolean) }),
])
export type SourceIntent = typeof SourceIntent.Type

export const ActionRecord = Schema.Struct({ fingerprint: Schema.String, sourceId: Schema.String })
export type ActionRecord = typeof ActionRecord.Type

export const ConversationContext = Schema.Struct({
  messages: Schema.Array(ChatMessage),
  sources: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, guidance: Schema.String, state: Schema.optional(Collection.fields.state), count: Schema.optional(Schema.Int), coverage: Schema.optional(Schema.String), question: Schema.NullOr(Schema.String) })),
  selectedSourceId: Schema.NullOr(Schema.String),
})
export type ConversationContext = typeof ConversationContext.Type
