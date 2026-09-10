import { useAtomSet } from "@effect/atom-react"
import { useCallback, useRef } from "react"
import { promptAtom } from "@/atoms/chat"
import { ThemeEffect } from "@/components/theme/ThemeEffect"
import { Composer } from "./Composer.tsx"
import { Header } from "./Header.tsx"
import { MessageList } from "./MessageList.tsx"
import { StatusBar } from "./StatusBar.tsx"

export function ChatPage() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const setPrompt = useAtomSet(promptAtom)

  const onSuggestion = useCallback(
    (text: string) => {
      setPrompt(text)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [setPrompt],
  )

  return (
    <div className="flex h-dvh flex-col">
      <ThemeEffect />
      <Header />
      <MessageList onSuggestion={onSuggestion} />
      <div className="relative shrink-0">
        <div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" />
        <StatusBar />
        <Composer textareaRef={textareaRef} />
      </div>
    </div>
  )
}
