import { code } from "@streamdown/code"
import { BotIcon } from "lucide-react"
import { memo } from "react"
import { Streamdown } from "streamdown"
import type { UiMessage } from "@/atoms/chat"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const plugins = { code }

export const MessageBubble = memo(function MessageBubble({ message }: { readonly message: UiMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    )
  }

  const streaming = message.status === "streaming"
  const empty = message.content.length === 0

  return (
    <div className="flex gap-3">
      <Avatar className="mt-0.5 size-7 shrink-0 border bg-muted">
        <AvatarFallback className="bg-transparent">
          <BotIcon className="size-4 text-muted-foreground" aria-hidden />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-2">
        {empty && streaming ? (
          <div className="flex h-6 items-center" aria-label="Waiting for response">
            <span className="size-2 animate-pulse rounded-full bg-muted-foreground/70" />
          </div>
        ) : (
          <div className={cn("chat-prose text-sm", empty && "text-muted-foreground italic")}>
            {empty ? (
              "No response."
            ) : (
              <Streamdown
                mode="streaming"
                isAnimating={streaming}
                plugins={plugins}
                {...(streaming ? { caret: "block" as const } : {})}
              >
                {message.content}
              </Streamdown>
            )}
          </div>
        )}
        {message.status === "interrupted" ? (
          <Badge variant="outline" className="text-muted-foreground">
            Stopped
          </Badge>
        ) : null}
        {message.status === "error" ? <Badge variant="destructive">Error</Badge> : null}
      </div>
    </div>
  )
})
