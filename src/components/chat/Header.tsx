import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Atom, AsyncResult } from "effect/unstable/reactivity"
import { MessageSquarePlusIcon, SparklesIcon } from "lucide-react"
import { chatInfoAtom, messagesAtom, promptAtom, sendMessageAtom } from "@/atoms/chat"
import { ModeToggle } from "@/components/theme/ModeToggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

function ModelBadge() {
  const info = useAtomValue(chatInfoAtom)
  return AsyncResult.builder(info)
    .onInitial(() => <Skeleton className="h-5 w-28 rounded-full" />)
    .onSuccess((i) => (
      <Badge variant="secondary" className="max-w-[40vw] truncate font-mono text-[11px]" title={i.model}>
        {i.model}
      </Badge>
    ))
    .onFailure(() => null)
    .render()
}

export function Header() {
  const hasMessages = useAtomValue(messagesAtom).length > 0
  const send = useAtomSet(sendMessageAtom)
  const setPrompt = useAtomSet(promptAtom)

  const newChat = () => {
    send(Atom.Reset)
    setPrompt("")
  }

  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-12 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <SparklesIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate text-sm font-semibold tracking-tight">Bid Desk Chat</span>
        </div>
        <ModelBadge />
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="New chat" disabled={!hasMessages} onClick={newChat} />
              }
            >
              <MessageSquarePlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
