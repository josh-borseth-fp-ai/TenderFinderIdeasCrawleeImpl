import { useAtomValue } from "@effect/atom-react"
import { ArrowDownIcon } from "lucide-react"
import { messagesAtom } from "@/atoms/chat"
import { Button } from "@/components/ui/button"
import { EmptyState } from "./EmptyState.tsx"
import { MessageBubble } from "./MessageBubble.tsx"
import { useStickToBottom } from "./useStickToBottom.ts"

export function MessageList({ onSuggestion }: { readonly onSuggestion: (text: string) => void }) {
  const messages = useAtomValue(messagesAtom)
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom()

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain" role="log" aria-live="off">
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex min-h-[60dvh] items-center py-10">
              <EmptyState onPick={onSuggestion} />
            </div>
          ) : (
            <ol className="flex flex-col gap-6 py-6">
              {messages.map((message, i) => (
                <li key={i}>
                  <MessageBubble message={message} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {!isAtBottom && messages.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            className="pointer-events-auto rounded-full shadow-md"
            onClick={() => scrollToBottom()}
          >
            <ArrowDownIcon className="size-3.5" />
            Jump to latest
          </Button>
        </div>
      ) : null}
    </div>
  )
}
