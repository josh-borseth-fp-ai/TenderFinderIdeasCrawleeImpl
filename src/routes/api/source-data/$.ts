import { createFileRoute } from "@tanstack/react-router"
import { sourceDataApi } from "@/server/onboarding/Api"
export const Route = createFileRoute("/api/source-data/$")({ server: { handlers: { GET: ({ request }) => sourceDataApi(request), POST: ({ request }) => sourceDataApi(request) } } })
