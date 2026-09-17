import { stringify } from "csv-stringify/sync"
import { Sse } from "effect/unstable/encoding"
import { BidRecord } from "../../domain/Source.ts"
import { Effect, Schema, Stream } from "effect"
import { onboarding } from "./Runtime.ts"
import { packageArchive, recordsCsv } from "./Archive.ts"

export async function checkSourceRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url), configuredOrigin = process.env.SCRAPER_APP_ORIGIN
  if (configuredOrigin ? url.origin !== configuredOrigin : !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return Response.json({ error: "Unrecognized application origin" }, { status: 403 })
  if (request.method === "POST") {
    const origin = request.headers.get("origin")
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== url.origin)) return Response.json({ error: "Cross-origin mutations are not allowed" }, { status: 403 })
    if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Expected application/json" }, { status: 415 })
    if ((await request.clone().text()).length > 100_000) return Response.json({ error: "Request too large" }, { status: 413 })
  }
}

export async function sourceApi(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const rejected = await checkSourceRequest(request)
    if (rejected) return rejected
    const service = await onboarding()
    const collectionId = url.searchParams.get("collectionId")
    if (collectionId) {
      const exportCount = service.store.collection(collectionId).count
      let page = 1
      const encoder = new TextEncoder()
      return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
        try {
          const result = service.store.resultPage(collectionId, page)
          const csv = stringify(result.records.slice(0, Math.max(0, exportCount - (page - 1) * 50)), { columns: Object.keys(BidRecord.fields), header: page === 1, quoted: true, escape_formulas: true, cast: { object: (value) => JSON.stringify(value) } })
          if (csv) controller.enqueue(encoder.encode(csv))
          if (page++ * 50 >= exportCount) controller.close()
        } catch (error) { controller.error(error) }
      } }), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="opportunities-${collectionId}.csv"` } })
    }
    const versionId = url.searchParams.get("versionId"), jobId = url.searchParams.get("jobId")
    const kind = url.searchParams.get("kind")
    if (versionId) {
      const version = service.store.version(versionId), files = service.files(version)
      if (kind === "download") return new Response(new Uint8Array(await packageArchive(files)), { headers: { "content-type": "application/x-tar", "content-disposition": `attachment; filename="scraper-${versionId}.tar"` } })
      return Response.json({ error: "Use the typed files endpoint" }, { status: 404 })
    }
    if (jobId) {
      service.store.job(jobId)
      const json = service.store.readArtifact(jobId, "results.json")
      if (kind === "csv") return new Response(recordsCsv(Schema.decodeSync(Schema.fromJsonString(Schema.Array(BidRecord)))(json)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="results-${jobId}.csv"` } })
      return new Response(json, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="results-${jobId}.json"` } })
    }
    return Response.json({ error: "Artifact not found" }, { status: 404 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Source request failed" }, { status: 400 })
  }
}

export async function sourceEvents(request: Request): Promise<Response> {
  const rejected = await checkSourceRequest(request)
  if (rejected) return rejected
  const service = await onboarding(), url = new URL(request.url), sourceId = url.searchParams.get("sourceId") ?? ""
  try { service.store.source(sourceId) } catch { return Response.json({ error: "Source not found" }, { status: 404 }) }
  let after = Number(request.headers.get("last-event-id") ?? "0")
  if (!Number.isSafeInteger(after) || after < 0) after = 0
  const progress = Stream.tick("1 second").pipe(
    Stream.flatMap(() => Stream.fromIterable(service.store.events(sourceId, after))),
    Stream.map((event) => {
      after = event.id
      return Sse.encoder.write({ _tag: "Event", event: "message", id: String(event.id), data: JSON.stringify(event) })
    }),
  )
  const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
  const interrupted = request.signal.aborted ? Effect.void : Stream.fromEventListener(request.signal, "abort").pipe(Stream.take(1), Stream.runDrain)
  const body = Stream.succeed(": connected\n\n").pipe(
    Stream.concat(Stream.merge(progress, heartbeat)),
    Stream.interruptWhen(interrupted),
    Stream.encodeText,
    Stream.toReadableStream,
  )
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } })
}
