import { afterEach, describe, expect, it, vi } from "vitest"
import http from "node:http"
import net from "node:net"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lookup } from "node:dns/promises"
import { Server, type ConnectionStats } from "proxy-chain"
import { startProxy } from "../../../runner/proxy.ts"
import { monitorTraffic } from "../../../runner/proxy-traffic.ts"

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }))
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers()
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function gateway(fixturePort?: number) {
  const directory = mkdtempSync(join(tmpdir(), "proxy-chain-test-"))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const socketPath = join(directory, "proxy.sock")
  const proxy = await startProxy(["fixture.test", "example.com", "127.0.0.1"], socketPath, fixturePort)
  cleanups.push(() => proxy.close())
  return socketPath
}
const request = (socketPath: string, path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const outgoing = http.get({ socketPath, path, agent: false }, (response) => {
    let body = ""
    response.setEncoding("utf8").on("data", (chunk) => { body += chunk })
    response.on("end", () => resolve({ status: response.statusCode ?? 0, body }))
    response.on("error", reject)
  })
  outgoing.on("error", reject)
})

describe("proxy-chain gateway", () => {
  it("forwards HTTP over the shared Unix socket and denies private/out-of-scope destinations", async () => {
    const fixture = http.createServer((req, res) => res.end(new URL(req.url!, "http://fixture.test").pathname))
    fixture.listen(0, "127.0.0.1"); await once(fixture, "listening")
    cleanups.push(() => new Promise<void>((resolve) => { fixture.closeAllConnections(); fixture.close(() => resolve()) }))
    const socketPath = await gateway((fixture.address() as net.AddressInfo).port)
    expect(await request(socketPath, "http://fixture.test/bids")).toEqual({ status: 200, body: "/bids" })
    expect((await request(socketPath, "http://unapproved.example/bids")).status).toBe(403)
    expect((await request(socketPath, "http://127.0.0.1/bids")).status).toBe(403)
    expect((await request(socketPath, "http://fixture.test:8080/bids")).status).toBe(403)
  })

  it("opens CONNECT tunnels through the library and transfers bytes in both directions", async () => {
    const destination = net.createServer((socket) => { socket.on("error", () => {}); socket.pipe(socket) })
    destination.listen(0, "127.0.0.1"); await once(destination, "listening")
    cleanups.push(() => new Promise<void>((resolve) => destination.close(() => resolve())))
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    const connect = net.createConnection
    // Substitute only the external wire connection; policy and proxy-chain's
    // CONNECT implementation run unchanged, without an internet dependency.
    vi.spyOn(net, "createConnection").mockImplementation(((options: net.NetConnectOpts, listener?: () => void) => {
      if ("host" in options && options.host === "example.com") {
        return connect({ host: "127.0.0.1", port: (destination.address() as net.AddressInfo).port }, listener)
      }
      return connect(options, listener)
    }) as typeof net.createConnection)
    const socketPath = await gateway()
    const outgoing = http.request({ socketPath, method: "CONNECT", path: "example.com:443", agent: false })
    const connected = once(outgoing, "connect")
    outgoing.end()
    const [response, socket] = await connected
    expect(response.statusCode).toBe(200)
    const payload = once(socket, "data")
    socket.write("encrypted bytes pass through unchanged")
    expect((await payload)[0].toString()).toBe("encrypted bytes pass through unchanged")
    socket.destroy()
  })

  it("counts completed and active traffic once and closes over-budget traffic once", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const stats = (bytes: number): ConnectionStats => ({ srcRxBytes: bytes, srcTxBytes: 0, trgTxBytes: null, trgRxBytes: null })
    const connections = new Map([[1, stats(60)]])
    const proxy = new Server({ port: 0 })
    vi.spyOn(proxy, "getConnectionIds").mockImplementation(() => [...connections.keys()])
    vi.spyOn(proxy, "getConnectionStats").mockImplementation((id) => connections.get(id))
    const exceeded = vi.fn(), stop = monitorTraffic(proxy, 100, exceeded)
    cleanups.push(stop)
    proxy.emit("connectionClosed", { stats: connections.get(1) })
    connections.delete(1)
    await Promise.resolve()
    vi.advanceTimersByTime(100)
    expect(exceeded).not.toHaveBeenCalled()
    connections.set(2, stats(50))
    vi.advanceTimersByTime(200)
    expect(exceeded).toHaveBeenCalledTimes(1)
  })
})
