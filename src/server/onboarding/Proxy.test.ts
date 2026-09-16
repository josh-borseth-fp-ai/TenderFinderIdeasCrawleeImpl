import { describe, it, expect, vi, beforeEach } from "vitest"
import { lookup } from "node:dns/promises"
import { publicAddress, resolveDestination } from "../../../runner/proxy.ts"
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }))
const dns = vi.mocked(lookup)
beforeEach(() => dns.mockReset())
describe("runner egress policy", () => {
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
