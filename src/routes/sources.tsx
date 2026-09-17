import { createFileRoute, Navigate } from "@tanstack/react-router"
import { LegacySource } from "@/components/chat/ChatPage"
export const Route = createFileRoute("/sources")({ ssr: false, validateSearch: (search: Record<string, unknown>) => ({ source: typeof search.source === "string" ? search.source : undefined }), component: SourcesRedirect })
function SourcesRedirect() { const { source } = Route.useSearch(); return source ? <LegacySource id={source} /> : <Navigate to="/" search={{ chat: undefined }} replace /> }
