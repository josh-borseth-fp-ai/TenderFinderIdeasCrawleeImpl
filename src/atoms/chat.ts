import { Effect, Option, Stream } from "effect"
import { Atom, AsyncResult, Reactivity } from "effect/unstable/reactivity"
import type { UiMessage, ChatFailure, SavedChatRequest } from "@/domain/Chat"
import type { ConversationDetail } from "@/domain/Conversation"
import { ChatClient, ChatClientError } from "./ChatClient.ts"
import { SourceClient, dataOr } from "./sources.ts"

export type { UiMessage, MessageStatus } from "@/domain/Chat"
export const Regenerate: unique symbol = Symbol.for("@app/chat/Regenerate")
export const promptAtom = Atom.make("")
export const selectedSourceAtom = Atom.make<string | null>(null)
export const activeConversationIdAtom = Atom.make<string | null>(null)
const turnAtom = Atom.make<SavedChatRequest | null>(null)
export const conversationsAtom = SourceClient.query("sources", "conversations", { reactivityKeys: ["chat"] })
export const conversationAtom = Atom.family((id: string) => SourceClient.query("sources", "conversation", { params: { id }, reactivityKeys: ["chat", "sources"] }))
const emptyConversationAtom = Atom.make(AsyncResult.success<ConversationDetail | null>(null))
export const currentConversationAtom = Atom.readable((get) => { const id = get(activeConversationIdAtom); return id ? get(conversationAtom(id)) : get(emptyConversationAtom) })
export const newConversationAtom = SourceClient.mutation("sources", "newConversation")
export const conversationActionAtom = SourceClient.mutation("sources", "conversationAction")
export const sourceConversationAtom = Atom.family((id: string) => SourceClient.query("sources", "sourceConversation", { params: { id } }))
export const resultsAtom = Atom.family((key: string) => {
  const [id, page] = key.split(":")
  return SourceClient.query("sources", "results", { params: { id: id! }, query: { page: Number(page) }, reactivityKeys: ["sources"] })
})
// Scoped polling reconciles persisted job messages even when no text response is streaming.
export const chatUpdatesAtom = SourceClient.runtime.atom(Stream.tick("5 seconds").pipe(Stream.tap(() => Reactivity.invalidate(["chat", "sources"]))))

export const sendMessageAtom = SourceClient.runtime.fn<string | typeof Regenerate>()(Effect.fnUntraced(function* (arg, get) {
  const api = yield* SourceClient
  const client = yield* Effect.provide(ChatClient, ChatClient.layer)
  let conversationId = get(activeConversationIdAtom)
  if (!conversationId) {
    const conversation = yield* api.sources.newConversation({ payload: { id: crypto.randomUUID() } })
    conversationId = conversation.id
    get.set(activeConversationIdAtom, conversationId)
  }
  const lastUser = dataOr(get(currentConversationAtom), null)?.messages.filter((message) => message.role === "user").at(-1)
  const recent = get(turnAtom)
  const previous = recent?.conversationId === conversationId ? recent : (lastUser ? { conversationId, turnId: lastUser.id.slice(conversationId.length + 1), content: lastUser.content, ...(lastUser.sourceIds[0] ? { sourceId: lastUser.sourceIds[0] } : {}) } : null)
  const sourceId = get(selectedSourceAtom)
  const request: SavedChatRequest = arg === Regenerate && previous?.conversationId === conversationId ? previous : {
    conversationId, turnId: crypto.randomUUID(), content: typeof arg === "string" ? arg : "Please try again.", ...(sourceId ? { sourceId } : {}),
  }
  get.set(turnAtom, request)
  const user: UiMessage = { id: `${conversationId}:${request.turnId}`, role: "user", content: request.content }
  let assistant: UiMessage = { id: `${user.id}:answer`, role: "assistant", content: "", status: "streaming" }
  return Stream.succeed<readonly UiMessage[]>([user, assistant]).pipe(Stream.concat(client.send(request).pipe(
    Stream.mapEffect((event) => {
      if (event._tag === "Error") return Effect.fail(new ChatClientError({ message: event.message }))
      if (event._tag === "TextDelta") assistant = { ...assistant, content: assistant.content + event.delta }
      if (event._tag === "Message") assistant = { ...assistant, id: event.id, sourceIds: event.sourceIds }
      if (event._tag === "Done") { const { status: _, ...complete } = assistant; assistant = complete }
      return Effect.succeed<readonly UiMessage[]>([user, assistant])
    }),
  )), Stream.ensuring(Reactivity.invalidate(["chat", "sources"])))
}, Stream.unwrap)).pipe(Atom.keepAlive)

export const messagesAtom = Atom.readable((get): readonly UiMessage[] => {
  const detail = dataOr(get(currentConversationAtom), null)
  const messages: UiMessage[] = detail?.messages.map((message) => ({ id: message.id, role: message.role, content: message.content, sourceIds: message.sourceIds, ...(message.status !== "complete" ? { status: message.status } : {}) })) ?? []
  const result = get(sendMessageAtom)
  if (get(turnAtom)?.conversationId !== get(activeConversationIdAtom)) return messages
  const local = AsyncResult.isFailure(result) ? Option.getOrElse(Option.map(result.previousSuccess, (value) => value.value), () => []) : dataOr(result, [])
  for (const message of local) {
    const index = messages.findIndex((item) => item.id === message.id)
    const next = AsyncResult.isFailure(result) && message.role === "assistant" ? { ...message, status: AsyncResult.isInterrupted(result) ? "interrupted" as const : "error" as const } : message
    if (index < 0) messages.push(next)
    else if (AsyncResult.isWaiting(result) || AsyncResult.isFailure(result)) messages[index] = next
  }
  return messages
})
export const isGeneratingAtom = Atom.readable((get) => get(turnAtom)?.conversationId === get(activeConversationIdAtom) && AsyncResult.isWaiting(get(sendMessageAtom)))
export const chatFailureAtom = Atom.readable((get): Option.Option<ChatFailure> => {
  const persisted = dataOr(get(currentConversationAtom), null)?.messages.at(-1)
  if (get(turnAtom)?.conversationId !== get(activeConversationIdAtom)) return persisted?.status === "error" || persisted?.status === "interrupted" ? Option.some({ kind: persisted.status, message: persisted.status === "interrupted" ? "Response stopped. You can retry it." : persisted.content }) : Option.none()
  const result = get(sendMessageAtom)
  if (!AsyncResult.isFailure(result)) return Option.none()
  return Option.some({ kind: AsyncResult.isInterrupted(result) ? "interrupted" : "error", message: Option.match(AsyncResult.error(result), { onNone: () => "Response stopped.", onSome: (error) => error instanceof Error ? error.message : "Request failed" }) })
})
export const canRetryAtom = Atom.readable((get) => Option.isSome(get(chatFailureAtom)))
export const stopResponse: typeof Atom.Interrupt = Atom.Interrupt

export const chatFailureValueAtom = Atom.map(chatFailureAtom, (value) => Option.getOrNull(value))
