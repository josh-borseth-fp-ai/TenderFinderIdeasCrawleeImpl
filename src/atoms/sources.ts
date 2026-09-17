import { Effect, Option, Queue, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Atom, AtomHttpApi, AsyncResult, Reactivity } from "effect/unstable/reactivity"
import { SourceApi } from "@/domain/SourceApi"
import { ProgressEvent, SourceError } from "@/domain/Source"

export class SourceClient extends AtomHttpApi.Service<SourceClient>()("@app/SourceClient", {
  api: SourceApi,
  httpClient: FetchHttpClient.layer,
}) {}

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
