import { createFileRoute } from "@tanstack/react-router"
import { SourceWorkspace } from "@/components/sources/SourceWorkspace"
export const Route = createFileRoute("/sources")({ ssr: false, validateSearch: (search: Record<string, unknown>) => ({ source: typeof search.source === "string" ? search.source : undefined }), component: SourceWorkspace })
