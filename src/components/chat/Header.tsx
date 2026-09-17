import { useAtomValue } from "@effect/atom-react"
import { MessageSquarePlusIcon, SparklesIcon } from "lucide-react"
import { activeConversationIdAtom, conversationsAtom } from "@/atoms/chat"
import { dataOr } from "@/atoms/sources"
import { ModeToggle } from "@/components/theme/ModeToggle"
import { Button } from "@/components/ui/button"

export function Header({ onSelect }: { readonly onSelect: (id: string | null) => void }) {
  const selected = useAtomValue(activeConversationIdAtom)
  const conversations = dataOr(useAtomValue(conversationsAtom), [])
  return <header className="border-b bg-background/90 backdrop-blur">
    <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
      <SparklesIcon className="size-4 shrink-0" aria-hidden />
      <span className="shrink-0 text-sm font-semibold">Bid Desk</span>
      <select aria-label="Conversation history" className="ml-auto min-w-0 max-w-64 truncate rounded-md border bg-background p-2 text-xs" value={selected ?? ""} onChange={(event) => onSelect(event.target.value || null)}>
        <option value="">New conversation</option>
        {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
        {selected && !conversations.some((conversation) => conversation.id === selected) && <option value={selected}>Current conversation</option>}
      </select>
      <Button variant="ghost" size="icon" aria-label="New chat" onClick={() => onSelect(null)}><MessageSquarePlusIcon className="size-4" /></Button>
      <ModeToggle />
    </div>
  </header>
}
