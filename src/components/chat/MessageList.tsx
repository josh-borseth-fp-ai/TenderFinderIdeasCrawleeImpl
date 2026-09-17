import { useAtomValue } from "@effect/atom-react"
import { ArrowDownIcon } from "lucide-react"
import { currentConversationAtom, messagesAtom } from "@/atoms/chat"
import { dataOr, failureMessage } from "@/atoms/sources"
import { Button } from "@/components/ui/button"
import { EmptyState } from "./EmptyState.tsx"
import { MessageBubble } from "./MessageBubble.tsx"
import { SourceCard } from "./SourceCard.tsx"
import { useStickToBottom } from "./useStickToBottom.ts"

export function MessageList({ onSuggestion, onAdjust }: { readonly onSuggestion: (text: string) => void; readonly onAdjust: (id: string, name: string) => void }) {
  const messages = useAtomValue(messagesAtom)
  const result = useAtomValue(currentConversationAtom)
  const detail = dataOr(result, null)
  const error = failureMessage(result)
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom()
  const cards = detail?.sources ?? []
  const lastMessage = (id: string) => [...messages].reverse().find((message) => message.sourceIds?.includes(id))?.id
  return <div className="relative min-h-0 flex-1">
    <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain" role="log" aria-live="off">
      <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        {error && <p role="alert" className="py-4 text-sm text-destructive">{error}</p>}
        {!messages.length && !cards.length ? <EmptyState onPick={onSuggestion} /> : <ol className="flex flex-col gap-6 py-6">
          {messages.map((message, index) => <li key={message.id ?? index} className="space-y-4"><MessageBubble message={message} />{cards.filter((card) => lastMessage(card.source.id) === message.id).map((card) => <SourceCard key={card.source.id} card={card} conversationId={detail!.conversation.id} onAdjust={onAdjust} />)}</li>)}
          {cards.filter((card) => !lastMessage(card.source.id)).map((card) => <li key={card.source.id}><SourceCard card={card} conversationId={detail!.conversation.id} onAdjust={onAdjust} /></li>)}
        </ol>}
      </div>
    </div>
    {!isAtBottom && messages.length > 0 && <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"><Button variant="secondary" size="sm" className="pointer-events-auto rounded-full shadow-md" onClick={() => scrollToBottom()}><ArrowDownIcon className="size-3.5" /> Jump to latest</Button></div>}
  </div>
}
