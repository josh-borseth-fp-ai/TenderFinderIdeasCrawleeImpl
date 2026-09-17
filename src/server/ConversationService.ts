import { Effect, Stream } from "effect"
import type { ChatEvent, SavedChatRequest } from "../domain/Chat.ts"
import type { SavedMessage, SourceIntent, ConversationContext } from "../domain/Conversation.ts"
import { ChatError, ChatService } from "./ChatService.ts"
import { ConversationIntentModel } from "./ConversationIntentModel.ts"
import { onboarding } from "./onboarding/Runtime.ts"

const failure = (error: unknown) => new ChatError({ message: error instanceof Error ? error.message : String(error) })

/** Stored messages are authoritative; clients cannot supply assistant history or tool results. */
export const conversationStream = (input: SavedChatRequest): Stream.Stream<ChatEvent, ChatError, ChatService | ConversationIntentModel> => Stream.unwrap(Effect.gen(function* () {
  const service = yield* Effect.tryPromise({ try: () => onboarding(), catch: failure })
  const store = service.store
  const detail = yield* Effect.try({ try: () => store.conversationDetail(input.conversationId), catch: failure })
  const id = `${input.conversationId}:${input.turnId}`
  const existingUser = store.chatMessage(id)
  if (existingUser && (existingUser.content !== input.content || existingUser.sourceIds[0] !== input.sourceId)) return Stream.fail(new ChatError({ message: "Turn ID already belongs to another message" }))
  const existing = store.chatMessage(`${id}:answer`)
  if (existing?.status === "complete" || existing?.status === "streaming") return Stream.fromIterable<ChatEvent>([
    { _tag: "Message", id: existing.id, sourceIds: existing.sourceIds }, { _tag: "TextDelta", delta: existing.content }, { _tag: "Done" },
  ])
  if (detail.messages.some((message) => message.status === "streaming")) return Stream.fail(new ChatError({ message: "Another response is still running in this conversation" }))
  const timestamp = new Date().toISOString()
  let assistant: SavedMessage = { id: `${id}:answer`, conversationId: input.conversationId, role: "assistant", content: "", sourceIds: existing?.sourceIds ?? [], status: "streaming", createdAt: existing?.createdAt ?? timestamp }
  store.transaction(() => {
    store.saveChatMessage({ id, conversationId: input.conversationId, role: "user", content: input.content, sourceIds: input.sourceId ? [input.sourceId] : [], status: "complete", createdAt: existingUser?.createdAt ?? timestamp })
    if (!detail.messages.length) store.renameConversation(input.conversationId, input.content)
    store.saveChatMessage(assistant)
  })
  const chat = yield* ChatService
  const model = yield* ConversationIntentModel
  const body = Stream.unwrap(Effect.gen(function* () {
    const completedAction = store.actionRecord(`${id}:source`) ?? store.actionRecord(`${id}:operate`)
    if (completedAction) {
      assistant = { ...assistant, sourceIds: [completedAction.sourceId] }
      return Stream.fromIterable<ChatEvent>([{ _tag: "Message", id: assistant.id, sourceIds: assistant.sourceIds }, { _tag: "TextDelta", delta: "Your source request was already received. Here is its latest progress and collected opportunities." }, { _tag: "Done" }])
    }
    const context: ConversationContext = { messages: [...detail.messages.filter((message) => message.id !== id && message.id !== `${id}:answer`).slice(-30).map(({ role, content }) => ({ role, content })), { role: "user" as const, content: input.content }], sources: detail.sources.map(({ source, collection, job }) => ({ id: source.id, name: source.brief.name, guidance: source.brief.guidance.slice(-2000), state: collection?.state, count: collection?.count, coverage: collection?.coverage, question: job?.state === "needs-input" ? job.message : null })), selectedSourceId: input.sourceId ?? null }
    const intent: SourceIntent = /^https?:\/\/\S+$/.test(input.content.trim()) ? { action: "discover", url: input.content.trim(), guidance: "" } : yield* model.decide(JSON.stringify(context))
    let answer: string
    if (intent.action === "discover" || intent.action === "refine") {
      const source = yield* Effect.try({ try: () => intent.action === "discover"
        ? service.discover(input.conversationId, `${id}:source`, intent.url, intent.guidance)
        : service.refine(input.conversationId, `${id}:source`, intent.sourceId, intent.guidance, intent.openOnly), catch: failure })
      assistant = { ...assistant, sourceIds: [source.id] }; store.saveChatMessage(assistant)
      answer = `I’m finding opportunities on ${source.brief.name}. I’ll show everything collected here.`
    } else if (intent.action === "operate") {
      yield* Effect.tryPromise({ try: () => service.conversationAction({ requestId: `${id}:operate`, conversationId: input.conversationId, sourceId: intent.sourceId, action: intent.operation }), catch: failure })
      assistant = { ...assistant, sourceIds: [intent.sourceId] }; store.saveChatMessage(assistant)
      answer = intent.operation === "stop" ? "Stopped. The opportunities already collected are still available." : intent.operation === "open" ? "Here are this source’s opportunities." : "I’m checking this source. Its opportunities will update here."
    } else if (intent.action === "sources") {
      for (const source of service.list()) store.linkSource(input.conversationId, source.id)
      assistant = { ...assistant, sourceIds: service.list().map((source) => source.id) }; store.saveChatMessage(assistant)
      answer = service.list().length ? "Here are your sources and their latest opportunities." : "Paste a website URL and I’ll find its opportunities."
    } else if (intent.action === "question") answer = intent.message
    else return chat.stream(context.messages, JSON.stringify(context.sources))
    return Stream.fromIterable<ChatEvent>([{ _tag: "Message", id: assistant.id, sourceIds: assistant.sourceIds }, { _tag: "TextDelta", delta: answer }, { _tag: "Done" }])
  }))
  return Stream.succeed<ChatEvent>({ _tag: "Message", id: assistant.id, sourceIds: assistant.sourceIds }).pipe(
    Stream.concat(body),
    Stream.catchTag("ChatError", (error) => Stream.succeed<ChatEvent>({ _tag: "Error", message: error.message })),
    Stream.tap((event) => Effect.sync(() => {
      if (event._tag === "TextDelta") assistant = { ...assistant, content: assistant.content + event.delta }
      if (event._tag === "Done") assistant = { ...assistant, status: "complete" }
      if (event._tag === "Error") assistant = { ...assistant, status: "error", content: assistant.content || event.message }
      store.saveChatMessage(assistant)
    })),
    Stream.ensuring(Effect.sync(() => {
      if (assistant.status === "streaming") store.saveChatMessage({ ...assistant, status: "interrupted" })
    })),
  )
}))
