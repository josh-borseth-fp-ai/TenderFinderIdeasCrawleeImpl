import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useRef } from "react"
import { activeConversationIdAtom, chatUpdatesAtom, promptAtom, selectedSourceAtom, sourceConversationAtom } from "@/atoms/chat"
import { dataOr, failureMessage } from "@/atoms/sources"
import { ThemeEffect } from "@/components/theme/ThemeEffect"
import { Composer } from "./Composer.tsx"
import { Header } from "./Header.tsx"
import { MessageList } from "./MessageList.tsx"
import { StatusBar } from "./StatusBar.tsx"

export function ChatPage() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const setPrompt = useAtomSet(promptAtom)
  const setSource = useAtomSet(selectedSourceAtom)
  const [active, setActive] = useAtom(activeConversationIdAtom)
  const { chat } = getRouteApi("/").useSearch()
  const navigate = useNavigate()
  useAtomValue(chatUpdatesAtom)
  useEffect(() => { setActive(chat ?? null); setSource(null) }, [chat, setActive, setSource])
  useEffect(() => { if (active && !chat) void navigate({ to: "/", search: { chat: active }, replace: true }) }, [active, chat, navigate])
  const onSuggestion = useCallback((text: string) => { setPrompt(text); requestAnimationFrame(() => textareaRef.current?.focus()) }, [setPrompt])
  const onSelect = (id: string | null) => { setActive(id); setPrompt(""); setSource(null); void navigate({ to: "/", search: { chat: id ?? undefined } }) }
  return <div className="flex h-dvh flex-col">
    <ThemeEffect /><Header onSelect={onSelect} />
    <MessageList onSuggestion={onSuggestion} onAdjust={(id, name) => { setSource(id); onSuggestion(`For ${name}, `) }} />
    <div className="relative shrink-0"><div className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background to-transparent" /><StatusBar /><Composer textareaRef={textareaRef} /></div>
  </div>
}
export function LegacySource({ id }: { readonly id: string }) {
  const result = useAtomValue(sourceConversationAtom(id))
  const conversation = dataOr(result, null)
  const navigate = useNavigate()
  useEffect(() => { if (conversation) void navigate({ to: "/", search: { chat: conversation.id }, replace: true }) }, [conversation?.id, navigate])
  return <p className="p-6 text-sm" role="status">{failureMessage(result) || "Opening conversation…"}</p>
}
