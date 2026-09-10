/**
 * Production server: `bun run build && bun run start`.
 * Serves the TanStack Start SSR handler from dist/server and static assets from dist/client.
 */
import { join } from "node:path"

const clientDir = join(import.meta.dir, "dist", "client")
interface StartHandler {
  readonly fetch: (request: Request) => Response | Promise<Response>
}
// Non-literal specifier: the build output has no type declarations and may not exist at typecheck time.
const serverEntry = "./dist/server/server.js"
const { default: handler } = (await import(serverEntry)) as { default: StartHandler }

const port = Number(process.env.PORT ?? 3000)

Bun.serve({
  port,
  idleTimeout: 0, // SSE responses can outlive the default 10s idle timeout
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(url.pathname)) {
        const file = Bun.file(join(clientDir, url.pathname))
        if (await file.exists()) {
          const immutable = url.pathname.startsWith("/assets/")
          return new Response(file, {
            headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600" },
          })
        }
      }
    }
    return handler.fetch(request)
  },
})

console.log(`Bid Desk Chat listening on http://localhost:${port}`)
