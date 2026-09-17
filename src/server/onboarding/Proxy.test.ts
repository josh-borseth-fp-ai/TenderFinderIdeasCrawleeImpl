import { describe, it, expect, vi, beforeEach } from "vitest"
import { lookup } from "node:dns/promises"
import { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import { publicAddress, resolveDestination, destinationPolicy } from "../../../runner/proxy-policy.ts"
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }))
const dns = vi.mocked(lookup)
beforeEach(() => dns.mockReset())
describe("runner egress policy", () => {
  const prepare = (url: string, hostname: string, port: number, isHttp = true) => {
    const request = new IncomingMessage(new Socket())
    request.url = url
    request.rawHeaders = ["Host", "unapproved.example", "Accept", "text/html"]
    return { request, hostname, port, isHttp, username: "", password: "", connectionId: 1 }
  }
  it("pins the checked address for HTTP and CONNECT without resolving twice", async () => {
    for (const [address, family] of [["93.184.216.34", 4], ["2606:4700:4700::1111", 6]] as const) {
      for (const isHttp of [true, false]) {
        dns.mockResolvedValueOnce([{ address, family }] as never)
        const input = prepare(isHttp ? "http://example.com/path" : "example.com:443", "example.com", isHttp ? 80 : 443, isHttp)
        const result = await destinationPolicy(["example.com"])(input)
        const callback = vi.fn()
        result?.dnsLookup?.("example.com", { all: true }, callback)
        expect(callback).toHaveBeenLastCalledWith(null, [{ address, family }])
        result?.dnsLookup?.("example.com", { all: false }, callback)
        expect(callback).toHaveBeenLastCalledWith(null, address, family)
        if (isHttp) expect(input.request.rawHeaders).toEqual(["Accept", "text/html", "Host", "example.com"])
      }
    }
    expect(dns).toHaveBeenCalledTimes(4)
  })
  it("blocks credentials and unexpected ports before resolving", async () => {
    const policy = destinationPolicy(["example.com"])
    for (const input of [prepare("http://user:password@example.com", "example.com", 80), prepare("http://example.com:8080", "example.com", 8080), prepare("example.com:80", "example.com", 80, false)]) {
      await expect(policy(input)).rejects.toThrow("Only public HTTP")
    }
    expect(dns).not.toHaveBeenCalled()
  })
  it("blocks private, mapped private, loopback and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:10.0.0.1", "fc00::1", "0.0.0.0"]) expect(publicAddress(ip)).toBe(false)
    expect(publicAddress("93.184.216.34")).toBe(true)
  })
  it("rejects hosts outside the exact domain allowlist before DNS", async () => {
    await expect(resolveDestination("not-example.com", ["example.com"])).rejects.toThrow("outside source")
    expect(dns).not.toHaveBeenCalled()
  })
  it("validates each new connection and refuses mixed public/private DNS answers", async () => {
    dns.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    expect(await resolveDestination("example.com", ["example.com"])).toEqual({ address: "93.184.216.34", family: 4 })
    dns.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] as never)
    await expect(resolveDestination("example.com", ["example.com"])).rejects.toThrow("Private or reserved")
    expect(dns).toHaveBeenCalledTimes(2)
  })
})
