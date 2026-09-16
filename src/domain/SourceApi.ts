import { PackageFiles } from "../../runner/contract.ts"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"
import { Job, Source, SourceCommand, SourceDetail, SourceError } from "./Source.ts"

const error = SourceError.pipe(HttpApiSchema.status(400))
export const SourceApi = HttpApi.make("SourceApi").add(HttpApiGroup.make("sources").add(
  HttpApiEndpoint.get("list", "/api/source-data/list", { success: Schema.Array(Source), error }),
  HttpApiEndpoint.get("detail", "/api/source-data/detail/:id", { params: { id: Schema.String }, success: SourceDetail, error }),
  HttpApiEndpoint.get("files", "/api/source-data/files/:id", { params: { id: Schema.String }, success: PackageFiles, error }),
  HttpApiEndpoint.post("command", "/api/source-data/command", { payload: Schema.Struct({ command: SourceCommand }), success: Schema.Union([SourceDetail, Job]), error }),
))
