import { Schema } from "effect"
import { Agent } from "node:http"
import { once } from "node:events"
import { chmodSync } from "node:fs"
import { Server, RequestError } from "proxy-chain"
import { destinationPolicy } from "./proxy-policy.ts"
import { monitorTraffic } from "./proxy-traffic.ts"
import { createRelay } from "./socket-relay.ts"

/** Apify owns HTTP forwarding, CONNECT tunnels, headers, and connection cleanup. */
export async function startProxy(domains: string[], socketPath: string, fixturePort?: number) {
  // Avoid reusing a connection selected by an earlier DNS check.
  const agent = new Agent({ keepAlive: false })
  const prepareDestination = destinationPolicy(domains)
  let exhausted = false
  const proxy = new Server({
    host: "127.0.0.1", port: 0,
    prepareRequestFunction: async (request) => {
      if (exhausted) throw new RequestError("Network byte limit exceeded", 429)
      // Only the integration-test CLI supplies fixturePort, never the application.
      if (fixturePort && request.isHttp && request.hostname === "fixture.test" && domains.includes("fixture.test") && request.port === 80) {
        return { upstreamProxyUrl: `http://127.0.0.1:${fixturePort}`, httpAgent: agent }
      }
      return { ...await prepareDestination(request), httpAgent: agent }
    },
  })
  proxy.server.on("connection", (socket) => socket.setTimeout(30_000, () => socket.destroy()))
  const stopMonitoring = monitorTraffic(proxy, 100 * 1024 * 1024, () => { exhausted = true; proxy.closeConnections() })
  let relay: ReturnType<typeof createRelay> | undefined
  const close = async () => {
    stopMonitoring(); agent.destroy()
    await proxy.close(true)
    if (relay) await new Promise<void>((resolve) => relay!.close(() => resolve()))
  }
  try {
    await proxy.listen()
    // proxy-chain requires TCP sockets; expose only a Unix relay to the worker.
    relay = createRelay({ port: proxy.port, host: "127.0.0.1" })
    const listening = once(relay, "listening")
    relay.listen(socketPath)
    await listening
    chmodSync(socketPath, 0o666)
    console.log("proxy-ready")
    return { close }
  } catch (error) {
    await close().catch(() => {})
    throw error
  }
}

if (process.argv[1]?.endsWith("proxy.ts")) {
  const domains = Schema.decodeSync(Schema.fromJsonString(Schema.mutable(Schema.Array(Schema.String))))(process.argv[2] ?? "[]")
  const fixture = process.argv.includes("--fixture") ? await import("./fixtures.ts").then((module) => module.startFixtures()) : undefined
  await startProxy(domains, "/proxy/egress.sock", fixture)
}
