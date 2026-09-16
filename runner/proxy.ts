import http from "node:http"
import net from "node:net"
import { lookup } from "node:dns/promises"
import { chmodSync } from "node:fs"
import ipaddr from "ipaddr.js"

export const publicAddress = (address: string) => ipaddr.isValid(address) && ipaddr.process(address).range() === "unicast"
export async function resolveDestination(hostname: string, domains: string[]) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!domains.includes(host)) throw new Error("Destination is outside source domains")
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true })
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("Private or reserved destination blocked")
  return addresses[0]!
}

export function startProxy(domains: string[], socketPath: string, fixturePort?: number) {
  let transferred = 0
  const sockets = new Set<net.Socket>()
  const destination = async (hostname: string) => {
    if (fixturePort && hostname === "fixture.test" && domains.includes(hostname)) return { address: "127.0.0.1", family: 4 }
    return resolveDestination(hostname, domains)
  }
  const budget = (socket: net.Socket, bytes: number) => {
    transferred += bytes
    if (transferred > 100 * 1024 * 1024) { socket.destroy(new Error("Network byte limit exceeded")); for (const active of sockets) active.destroy() }
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "")
      if (url.protocol !== "http:" || url.username || url.password || (url.port && url.port !== "80")) throw new Error("Only public HTTP port 80 is supported")
      const resolved = await destination(url.hostname)
      const upstream = http.request({
        hostname: resolved.address, family: resolved.family, port: fixturePort && url.hostname === "fixture.test" ? fixturePort : 80,
        method: request.method, path: `${url.pathname}${url.search}`, timeout: 30_000,
        headers: { ...Object.fromEntries(Object.entries(request.headers).filter(([key]) => !["proxy-authorization", "proxy-connection", "connection", "host"].includes(key))), host: url.host, connection: "close" },
      }, (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers)
        incoming.on("data", (chunk: Buffer) => budget(request.socket, chunk.length))
        incoming.pipe(response)
        response.on("close", () => incoming.destroy())
      })
      upstream.on("timeout", () => upstream.destroy(new Error("Proxy timeout")))
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end() })
      request.on("data", (chunk: Buffer) => budget(request.socket, chunk.length))
      request.on("error", () => upstream.destroy())
      response.on("close", () => upstream.destroy())
      request.pipe(upstream)
    } catch { response.writeHead(403); response.end("Destination blocked by source network policy") }
  })
  server.on("connect", async (request, client, head) => {
    try {
      const target = new URL(`https://${request.url}`)
      if (target.username || target.password || (target.port && target.port !== "443")) throw new Error("Only TLS port 443 is supported")
      const resolved = await destination(target.hostname)
      const upstream = net.connect({ host: resolved.address, family: resolved.family, port: 443 })
      upstream.setTimeout(30_000, () => upstream.destroy())
      upstream.on("connect", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client) })
      upstream.on("data", (chunk: Buffer) => budget(upstream, chunk.length))
      client.on("data", (chunk: Buffer) => budget(upstream, chunk.length))
      upstream.on("error", () => client.destroy())
      client.on("error", () => upstream.destroy())
      client.on("close", () => upstream.destroy())
      upstream.on("close", () => client.destroy())
      sockets.add(upstream); upstream.on("close", () => sockets.delete(upstream))
    } catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n") }
  })
  server.on("connection", (socket) => { sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket)) })
  server.listen(socketPath, () => { chmodSync(socketPath, 0o666); console.log("proxy-ready") })
  return server
}

if (process.argv[1]?.endsWith("proxy.ts")) {
  const domains: string[] = JSON.parse(process.argv[2] ?? "[]")
  // Only the integration-test CLI supplies this argument, never the application.
  const fixture = process.argv.includes("--fixture") ? await import("./fixtures.ts").then((module) => module.startFixtures()) : undefined
  startProxy(domains, "/proxy/egress.sock", fixture)
}
