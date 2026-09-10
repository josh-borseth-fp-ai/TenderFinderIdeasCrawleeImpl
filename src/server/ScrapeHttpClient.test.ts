import { afterEach, describe, expect, it, vi } from "vitest"
import { Readable } from "node:stream"
import { GotScrapingHttpClient, type HttpRequest } from "crawlee"
import { assertPublicAddress, MAX_RESPONSE_BYTES, publicUrl, ScrapeHttpClient } from "./ScrapeHttpClient.ts"

vi.mock("node:dns", () => ({
  lookup: (hostname: string, _options: unknown, callback: (error: null, addresses: Array<{ address: string; family: number }>) => void) => callback(null, [
    { address: hostname === "public.example" ? "93.184.216.34" : "127.0.0.1", family: 4 },
  ]),
}))

afterEach(() => vi.restoreAllMocks())

const fixture = (request: HttpRequest, chunks: Array<Buffer | string>, contentType = "text/html") => ({
  stream: Readable.from(chunks), request, url: String(request.url), statusCode: 200,
  headers: { "content-type": contentType }, trailers: {}, complete: true, redirectUrls: [],
  downloadProgress: { percent: 1, transferred: 0 }, uploadProgress: { percent: 1, transferred: 0 },
})
const client = () => new ScrapeHttpClient(new AbortController().signal)

describe("scrape URL and connection policy", () => {
  it.each(["garbage", "file:///etc/passwd", "ftp://example.com", "https://user:pass@example.com", "http://localhost", "http://localhost.", "http://sub.localhost", "http://127.1", "http://2130706433", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "http://[::ffff:127.0.0.1]"])("rejects %s", (url) => {
    expect(() => publicUrl(url)).toThrow()
  })
  it.each(["0.0.0.0", "100.64.0.1", "172.16.0.1", "192.168.0.1", "224.0.0.1", "255.255.255.255", "fe80::1", "fc00::1", "2001:db8::1"])("rejects reserved address %s", (address) => {
    expect(() => assertPublicAddress(address)).toThrow()
  })
  it("accepts public addresses and normalizes URLs", () => {
    expect(publicUrl("https://example.com#section").href).toBe("https://example.com/")
    expect(() => assertPublicAddress("93.184.216.34")).not.toThrow()
    expect(() => assertPublicAddress("2606:4700:4700::1111")).not.toThrow()
  })
  it("guards redirects and validates the DNS answer supplied to the connection", async () => {
    let options: HttpRequest | undefined
    vi.spyOn(GotScrapingHttpClient.prototype, "stream").mockImplementation(async (request) => {
      options = request
      return fixture(request, ["<p>ok</p>"])
    })
    const response = await client().stream({ url: "https://example.com" })
    response.stream.resume()
    const hooks = options!.hooks as { beforeRedirect: Array<(options: { url: URL }) => void> }
    expect(() => hooks.beforeRedirect[0]!({ url: new URL("http://127.0.0.1") })).toThrow()
    expect(() => hooks.beforeRedirect[0]!({ url: new URL("https://user:password@example.com") })).toThrow()
    const lookup = options!.dnsLookup as import("node:net").LookupFunction
    const address = await new Promise((resolve, reject) => lookup("public.example", {}, (error, value) => error ? reject(error) : resolve(value)))
    expect(address).toBe("93.184.216.34")
    await expect(new Promise((resolve, reject) => lookup("rebound.example", {}, (error, value) => error ? reject(error) : resolve(value)))).rejects.toThrow("private")
    expect(options!.http2).toBe(false)
    expect(options!.dnsCache).toBe(false)
  })
  it("rejects non-HTML responses and closes the source", async () => {
    const response = fixture({ url: "https://example.com" }, ["{}"], "application/json")
    vi.spyOn(GotScrapingHttpClient.prototype, "stream").mockResolvedValue(response)
    await expect(client().stream(response.request)).rejects.toThrow("HTML")
    expect(response.stream.destroyed).toBe(true)
  })
  it("limits actual streamed body bytes and closes oversized responses", async () => {
    const response = fixture({ url: "https://example.com" }, [Buffer.alloc(MAX_RESPONSE_BYTES), Buffer.from("x")])
    vi.spyOn(GotScrapingHttpClient.prototype, "stream").mockResolvedValue(response)
    const limited = await client().stream(response.request)
    await expect((async () => { for await (const _chunk of limited.stream) { /* drain */ } })()).rejects.toThrow("5 MB")
    expect(response.stream.destroyed).toBe(true)
  })
})
