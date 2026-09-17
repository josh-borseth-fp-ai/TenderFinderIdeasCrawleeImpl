import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import { type KeyboardEvent, type RefObject, useLayoutEffect } from "react"
import { isGeneratingAtom, promptAtom, sendMessageAtom, stopResponse, selectedSourceAtom, currentConversationAtom } from "@/atoms/chat"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { dataOr } from "@/atoms/sources"

const MAX_ROWS = 8
const LINE_HEIGHT_PX = 24

export function Composer({ textareaRef }: { readonly textareaRef: RefObject<HTMLTextAreaElement | null> }) {
  const [selectedSource, setSelectedSource] = useAtom(selectedSourceAtom)
  const detail = dataOr(useAtomValue(currentConversationAtom), null)
  const sourceName = detail?.sources.find((card) => card.source.id === selectedSource)?.source.brief.name
  const [prompt, setPrompt] = useAtom(promptAtom)
  const generating = useAtomValue(isGeneratingAtom)
  const send = useAtomSet(sendMessageAtom)

  const trimmed = prompt.trim()
  const canSend = trimmed.length > 0 && !generating

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "0px"
    const max = MAX_ROWS * LINE_HEIGHT_PX
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden"
  }, [prompt, textareaRef])

  const submit = () => {
    if (!canSend) return
    send(trimmed)
    setPrompt("")
  }

  const stop = () => send(stopResponse)

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && generating) {
      e.preventDefault()
      stop()
      return
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="rounded-3xl border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40">
        {sourceName && <div className="flex items-center gap-2 px-4 pt-3 text-xs text-muted-foreground"><span>Regarding {sourceName}</span><button type="button" aria-label="Clear source context" onClick={() => setSelectedSource(null)}>×</button></div>}
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Paste a website URL or ask a question…"
          rows={1}
          aria-label="Message"
          className="min-h-0 resize-none border-0 bg-transparent px-4 pt-3.5 pb-1 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
          <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> send
            </span>
            <span className="flex items-center gap-1">
              <KbdGroup>
                <Kbd>Shift</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              newline
            </span>
            {generating ? (
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd> stop
              </span>
            ) : null}
          </div>
          <div className="ml-auto">
            {generating ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button type="button" size="icon" variant="default" aria-label="Stop generating" onClick={stop} />
                  }
                >
                  <SquareIcon className="size-3.5 fill-current" />
                </TooltipTrigger>
                <TooltipContent>Stop</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={<Button type="submit" size="icon" aria-label="Send message" disabled={!canSend} />}
                >
                  <ArrowUpIcon className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Send</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
