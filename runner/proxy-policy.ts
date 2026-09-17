import net from "node:net"
import type { LookupFunction } from "node:net"
import type { lookup as nodeLookup } from "node:dns"
import { lookup } from "node:dns/promises"
import ipaddr from "ipaddr.js"
import { RequestError, type PrepareRequestFunction } from "proxy-chain"

export const publicAddress = (address: string) => ipaddr.isValid(address) && ipaddr.process(address).range() === "unicast"
export async function resolveDestination(hostname: string, domains: readonly string[]) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!domains.includes(host)) throw new RequestError("Destination is outside source domains", 403)
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true })
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new RequestError("Private or reserved destination blocked", 403)
  return addresses[0]!
}

/** Check once, then supply that exact address to Node's connection lookup. */
export const destinationPolicy = (domains: readonly string[]): PrepareRequestFunction => async ({ request, hostname, port, isHttp }) => {
  const target = new URL(isHttp ? request.url! : `https://${request.url}`)
  if (target.username || target.password || port !== (isHttp ? 80 : 443)) throw new RequestError("Only public HTTP port 80 and HTTPS port 443 are supported", 403)
  const resolved = await resolveDestination(hostname, domains)
  if (isHttp) {
    // Bind the HTTP Host header to the same destination that passed policy.
    request.rawHeaders = request.rawHeaders.flatMap((value, index, headers) => index % 2 === 0 && value.toLowerCase() !== "host" ? [value, headers[index + 1]!] : [])
    request.rawHeaders.push("Host", target.host)
  }
  const pinnedLookup: LookupFunction = (_host, options, callback) => {
    // Node may request all addresses for automatic address-family selection.
    if (options.all) callback(null, [resolved])
    else callback(null, resolved.address, resolved.family)
  }
  return {
    // proxy-chain types this as the complete overloaded dns.lookup API, but
    // passes it to http.request/net.connect as a standard Node LookupFunction.
    dnsLookup: pinnedLookup as typeof nodeLookup,
    ipFamily: resolved.family,
  }
}
