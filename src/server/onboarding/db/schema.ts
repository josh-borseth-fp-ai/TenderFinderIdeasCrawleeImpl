import { index, integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core"
import type { Job, ScraperVersion, Source, SourceMessage } from "../../../domain/Source.ts"

export const sources = sqliteTable("sources", {
  id: text().primaryKey(),
  payload: text({ mode: "json" }).$type<Source>().notNull(),
})
export const messages = sqliteTable("messages", {
  id: text().primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  payload: text({ mode: "json" }).$type<SourceMessage>().notNull(),
}, (table) => [index("messages_source").on(table.sourceId)])
export const versions = sqliteTable("versions", {
  id: text().primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  payload: text({ mode: "json" }).$type<ScraperVersion>().notNull(),
}, (table) => [index("versions_source").on(table.sourceId)])
export const jobs = sqliteTable("jobs", {
  id: text().primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id),
  payload: text({ mode: "json" }).$type<Job>().notNull(),
}, (table) => [index("jobs_source").on(table.sourceId)])
export const events = sqliteTable("events", {
  id: integer().primaryKey({ autoIncrement: true }),
  jobId: text("job_id").notNull().references(() => jobs.id),
  sourceId: text("source_id").notNull(),
  message: text().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("events_source_cursor").on(table.sourceId, table.id)])

export const conversations = sqliteTable("conversations", { id: text().primaryKey(), payload: text({ mode: "json" }).$type<import("../../../domain/Conversation.ts").Conversation>().notNull() })
export const chatMessages = sqliteTable("chat_messages", {
  id: text().primaryKey(), conversationId: text("conversation_id").notNull().references(() => conversations.id),
  payload: text({ mode: "json" }).$type<import("../../../domain/Conversation.ts").SavedMessage>().notNull(),
}, (table) => [index("chat_messages_conversation").on(table.conversationId)])
export const conversationSources = sqliteTable("conversation_sources", {
  conversationId: text("conversation_id").notNull().references(() => conversations.id), sourceId: text("source_id").notNull().references(() => sources.id),
}, (table) => [primaryKey({ columns: [table.conversationId, table.sourceId] })])
export const collections = sqliteTable("collections", {
  id: text().primaryKey().references(() => jobs.id), sourceId: text("source_id").notNull().references(() => sources.id),
  payload: text({ mode: "json" }).$type<import("../../../domain/Conversation.ts").Collection>().notNull(),
})
export const collectionRecords = sqliteTable("collection_records", {
  collectionId: text("collection_id").notNull().references(() => collections.id), id: text().notNull(),
  payload: text({ mode: "json" }).$type<import("../../../domain/Source.ts").BidRecord>().notNull(),
}, (table) => [primaryKey({ columns: [table.collectionId, table.id] })])
export const actions = sqliteTable("chat_actions", { id: text().primaryKey(), payload: text({ mode: "json" }).$type<import("../../../domain/Conversation.ts").ActionRecord>().notNull() })
