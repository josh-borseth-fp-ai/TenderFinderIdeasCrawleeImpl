import { createFileRoute } from "@tanstack/react-router"
import { sourceApi } from "@/server/onboarding/Http"
export const Route = createFileRoute("/api/sources")({ server: { handlers: { GET: ({ request }) => sourceApi(request) } } })
