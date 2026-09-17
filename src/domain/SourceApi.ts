import { PackageFiles } from "../../runner/contract.ts"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { Job, Source, SourceCommand, SourceDetail, SourceError } from "./Source.ts"

import { Conversation, ConversationAction, ConversationDetail, ResultPage } from "./Conversation.ts"

const error = SourceError.pipe(HttpApiSchema.status(400))
export const SourceApi = HttpApi.make("SourceApi").add(HttpApiGroup.make("sources").add(
  HttpApiEndpoint.get("conversations", "/api/source-data/conversations", { success: Schema.Array(Conversation), error }),
  HttpApiEndpoint.post("newConversation", "/api/source-data/conversations", { payload: Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)) }), success: Conversation, error }),
  HttpApiEndpoint.get("conversation", "/api/source-data/conversation/:id", { params: { id: Schema.String }, success: ConversationDetail, error }),
  HttpApiEndpoint.get("sourceConversation", "/api/source-data/source-conversation/:id", { params: { id: Schema.String }, success: Conversation, error }),
  HttpApiEndpoint.post("conversationAction", "/api/source-data/conversation-action", { payload: ConversationAction, success: ConversationDetail, error }),
  HttpApiEndpoint.get("results", "/api/source-data/results/:id", { params: { id: Schema.String }, query: { page: Schema.FiniteFromString }, success: ResultPage, error }),
  HttpApiEndpoint.get("list", "/api/source-data/list", { success: Schema.Array(Source), error }),
  HttpApiEndpoint.get("detail", "/api/source-data/detail/:id", { params: { id: Schema.String }, success: SourceDetail, error }),
  HttpApiEndpoint.get("files", "/api/source-data/files/:id", { params: { id: Schema.String }, success: PackageFiles, error }),
  HttpApiEndpoint.post("command", "/api/source-data/command", { payload: Schema.Struct({ command: SourceCommand }), success: Schema.Union([SourceDetail, Job]), error }),
))
