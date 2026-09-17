import { createServer, connect, type NetConnectOpts } from "node:net"
import { pipeline } from "node:stream/promises"

/** Byte transport only. Node's pipeline owns backpressure, errors, and cleanup. */
export const createRelay = (target: NetConnectOpts) => createServer((client) => {
  void pipeline(client, connect(target), client).catch(() => {})
})
