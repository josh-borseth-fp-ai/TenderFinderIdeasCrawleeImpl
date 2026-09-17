import { createFileRoute } from "@tanstack/react-router"
import { ChatPage } from "@/components/chat/ChatPage"

export const Route = createFileRoute("/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ chat: typeof search.chat === "string" ? search.chat : undefined }),
  component: ChatPage,
})
