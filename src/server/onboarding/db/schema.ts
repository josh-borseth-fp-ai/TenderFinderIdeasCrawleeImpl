import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
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
