import { Effect, Option, Stream } from "effect"
import { Atom, AsyncResult } from "effect/unstable/reactivity"
import type { UiMessage, MessageStatus, ChatFailure } from "@/domain/Chat"
import { ChatClient, ChatClientError } from "./ChatClient.ts"
import { runtime } from "./runtime.ts"

export type { UiMessage, MessageStatus } from "@/domain/Chat"

/** Write this to sendMessageAtom to regenerate the last assistant answer. */
export const Regenerate: unique symbol = Symbol.for("@app/chat/Regenerate")
export type SendArg = string | typeof Regenerate

export const promptAtom = Atom.make("")

export const chatInfoAtom = runtime.atom(Effect.flatMap(ChatClient, (client) => client.info))

const strip = ({ role, content }: UiMessage): UiMessage => ({ role, content })

/** Latest known message list, including the partial result kept on a Failure. */
const latestMessages = (
  result: AsyncResult.AsyncResult<ReadonlyArray<UiMessage>, unknown>,
): ReadonlyArray<UiMessage> =>
  AsyncResult.isFailure(result)
    ? Option.match(result.previousSuccess, { onNone: () => [], onSome: (s) => s.value })
    : Option.getOrElse(AsyncResult.value(result), (): ReadonlyArray<UiMessage> => [])

/**
 * Owns the conversation. Each write starts a stream whose emissions are the
 * full message list, so everything rendered is derived from this atom.
 */
export const sendMessageAtom = runtime
  .fn<SendArg>()(
    Effect.fnUntraced(function* (arg, get) {
      const client = yield* ChatClient
      const previous = get.self<AsyncResult.AsyncResult<ReadonlyArray<UiMessage>, ChatClientError>>()
      const history = Option.match(previous, { onNone: (): ReadonlyArray<UiMessage> => [], onSome: latestMessages })

      // Drop a trailing assistant message when regenerating, or when the last run failed/was stopped.
      const failed = Option.exists(previous, AsyncResult.isFailure)
      const trimmed =
        (arg === Regenerate || failed) && history.at(-1)?.role === "assistant" ? history.slice(0, -1) : history

      const stable: ReadonlyArray<UiMessage> =
        arg === Regenerate ? trimmed.map(strip) : [...trimmed.map(strip), { role: "user", content: arg }]

      if (stable.at(-1)?.role !== "user") {
        return Stream.succeed(stable)
      }

      const withAssistant = (text: string): ReadonlyArray<UiMessage> => [
        ...stable,
        { role: "assistant", content: text, status: "streaming" },
      ]

      // Emit the user message immediately. Stream.scan only emits its seed once the
      // first upstream chunk arrives, so without this an instant failure would leave
      // the fn with no previous success (and the UI with no messages).
      return Stream.succeed(withAssistant("")).pipe(
        Stream.concat(
          client.send(stable).pipe(
            Stream.takeWhile((event) => event._tag !== "Done"),
            Stream.flatMap((event) =>
              event._tag === "Error"
                ? Stream.fail(new ChatClientError({ message: event.message }))
                : Stream.succeed(event.delta),
            ),
            Stream.scan("", (text, delta) => text + delta),
            Stream.map(withAssistant),
          ),
        ),
      )
    }, Stream.unwrap),
  )
  .pipe(Atom.keepAlive)

/** Messages to render, with the trailing assistant message flagged from the fn state. */
export const messagesAtom = Atom.readable((get): ReadonlyArray<UiMessage> => {
  const result = get(sendMessageAtom)
  const messages = latestMessages(result)
  if (messages.length === 0) return messages

  if (AsyncResult.isSuccess(result)) {
    return result.waiting ? messages : messages.map(strip)
  }
  if (AsyncResult.isFailure(result)) {
    const status: MessageStatus = AsyncResult.isInterrupted(result) ? "interrupted" : "error"
    const last = messages.at(-1)
    if (last?.role === "assistant") {
      return [...messages.slice(0, -1).map(strip), { ...strip(last), status }]
    }
    return messages.map(strip)
  }
  return messages
})

export const isGeneratingAtom = Atom.map(sendMessageAtom, AsyncResult.isWaiting)

/** Failure detail for the status bar. None while idle/generating/success. */
export const chatFailureAtom = Atom.readable((get): Option.Option<ChatFailure> => {
  const result = get(sendMessageAtom)
  if (!AsyncResult.isFailure(result)) return Option.none()
  if (AsyncResult.isInterrupted(result)) return Option.some({ kind: "interrupted", message: "Generation stopped." })
  const message = Option.match(AsyncResult.error(result), {
    onNone: () => "Something went wrong.",
    onSome: (e) => (e instanceof Error ? e.message : String(e)),
  })
  return Option.some({ kind: "error", message })
})

export const canRetryAtom = Atom.readable((get) => {
  const failure = get(chatFailureAtom)
  return Option.isSome(failure) && get(messagesAtom).some((m) => m.role === "user")
})
