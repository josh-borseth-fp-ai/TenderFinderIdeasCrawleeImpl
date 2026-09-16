import { Effect, Option, Queue, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Atom, AtomHttpApi, AsyncResult, Reactivity } from "effect/unstable/reactivity"
import { SourceApi } from "@/domain/SourceApi"
import { ProgressEvent, SourceError, type SourceDetail } from "@/domain/Source"

export class SourceClient extends AtomHttpApi.Service<SourceClient>()("@app/SourceClient", {
  api: SourceApi,
  httpClient: FetchHttpClient.layer,
}) {}

export const sourcesAtom = SourceClient.query("sources", "list", { reactivityKeys: ["sources"] })
export const sourceDetailAtom = Atom.family((id: string) => SourceClient.query("sources", "detail", { params: { id }, reactivityKeys: ["sources"] }))
export const sourceFilesAtom = Atom.family((id: string) => SourceClient.query("sources", "files", { params: { id } }))
export const sourceCommandAtom = SourceClient.mutation("sources", "command")
export const noDetailAtom = Atom.make<AsyncResult.AsyncResult<SourceDetail, SourceError>>(AsyncResult.initial())
export const noFilesAtom = Atom.make(AsyncResult.success<Record<string, string>>({}))
export const noEventsAtom = Atom.make(AsyncResult.success<ProgressEvent[]>([]))

// Native EventSource owns reconnection and Last-Event-ID; the atom owns its lifetime.
export const sourceEventsAtom = Atom.family((id: string) => SourceClient.runtime.atom(
  Stream.callback<ProgressEvent, SourceError>((queue) => Effect.acquireRelease(
    Effect.sync(() => {
      const events = new EventSource(`/api/source-events?sourceId=${encodeURIComponent(id)}`)
      events.onmessage = (message) => {
        try { Queue.offerUnsafe(queue, Schema.decodeSync(Schema.fromJsonString(ProgressEvent))(message.data)) }
        catch { Effect.runSync(Queue.fail(queue, new SourceError({ message: "Invalid source progress event" }))) }
      }
      return events
    }),
    (events) => Effect.sync(() => events.close()),
  )).pipe(
    Stream.scan([] as ProgressEvent[], (events, event) => [...events.filter((item) => item.id !== event.id), event].slice(-40)),
    Stream.debounce("100 millis"),
    Stream.tap(() => Reactivity.invalidate(["sources"])),
  ),
))

export const dataOr = <A, E>(result: AsyncResult.AsyncResult<A, E>, fallback: A): A => Option.getOrElse(AsyncResult.value(result), () => fallback)
export const failureMessage = <A, E>(result: AsyncResult.AsyncResult<A, E>): string => Option.match(AsyncResult.error(result), {
  onNone: () => "",
  onSome: (error) => error instanceof Error ? error.message : "Source request failed",
})
export const isWaiting = AsyncResult.isWaiting
