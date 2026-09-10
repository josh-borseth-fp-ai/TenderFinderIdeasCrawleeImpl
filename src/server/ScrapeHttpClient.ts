import { lookup } from "node:dns"
import { isIP, type LookupFunction } from "node:net"
import { Transform } from "node:stream"
import { GotScrapingHttpClient, type HttpRequest, type RedirectHandler } from "crawlee"
import ipaddr from "ipaddr.js"
import { ScrapeError } from "../domain/Scrape.ts"

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export function assertPublicAddress(address: string): void {
  // process() also converts IPv4-mapped IPv6 addresses before classifying them.
  if (!ipaddr.isValid(address) || ipaddr.process(address).range() !== "unicast") {
    throw new ScrapeError({ message: "Scraping local, private, or reserved addresses is not allowed." })
  }
}

export function publicUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) } catch {
    throw new ScrapeError({ message: "Provide a valid HTTP(S) URL." })
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ScrapeError({ message: "Only HTTP(S) URLs without credentials are supported." })
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  if (hostname.toLowerCase().replace(/\.$/, "") === "localhost" || hostname.toLowerCase().endsWith(".localhost")) {
    throw new ScrapeError({ message: "Scraping localhost is not allowed." })
  }
  if (isIP(hostname)) assertPublicAddress(hostname)
  url.hash = ""
  return url
}

// Validate the addresses returned to the socket itself, avoiding a separate DNS
// preflight whose answer could change before the actual connection.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4)
    try {
      if (addresses.length === 0) throw new Error("No addresses found")
      for (const { address } of addresses) assertPublicAddress(address)
      const first = addresses[0]!
      callback(null, options.all ? addresses : first.address, first.family)
    } catch (cause) {
      callback(cause instanceof Error ? cause : new Error("Invalid destination"), "", 4)
    }
  })
}

/** Server-only transport policy, applied to every request and redirect. */
export class ScrapeHttpClient extends GotScrapingHttpClient {
  constructor(private readonly signal: AbortSignal) { super() }

  override async stream(request: HttpRequest, onRedirect?: RedirectHandler) {
    publicUrl(String(request.url))
    const { proxyUrl: _proxy, ...directRequest } = request
    const response = await super.stream({
      ...directRequest,
      signal: this.signal,
      // Disable HTTP/2's separate connection-resolution path and DNS caching.
      http2: false,
      dnsCache: false,
      dnsLookup: publicLookup,
      agent: { http: undefined, https: undefined },
      retry: { limit: 0 },
      maxRedirects: 5,
      https: { rejectUnauthorized: true },
      hooks: {
        beforeRequest: [(options: { url: URL }) => { publicUrl(options.url.href) }],
        beforeRedirect: [(options: { url: URL }) => { publicUrl(options.url.href) }],
      },
    }, onRedirect)
    const source = response.stream
    const contentType = String(response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase()
    if (!["text/html", "application/xhtml+xml"].includes(contentType ?? "")) {
      source.destroy()
      throw new ScrapeError({ message: "The URL did not return an HTML page." })
    }
    let bytes = 0
    const limited = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        callback(bytes > MAX_RESPONSE_BYTES ? new ScrapeError({ message: "Page exceeds the 5 MB response limit." }) : null, chunk)
      },
    })
    source.on("error", (error) => limited.destroy(error))
    limited.on("close", () => source.destroy())
    source.pipe(limited)
    return { ...response, stream: limited }
  }
}
