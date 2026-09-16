import { createFileRoute } from "@tanstack/react-router"
import { sourceEvents } from "@/server/onboarding/Http"
export const Route = createFileRoute("/api/source-events")({ server: { handlers: { GET: ({ request }) => sourceEvents(request) } } })
