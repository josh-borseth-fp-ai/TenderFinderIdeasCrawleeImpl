import type { Server, ConnectionStats } from "proxy-chain"

/** Enforce a per-run budget using the library's live and completed byte counts. */
export function monitorTraffic(proxy: Server, maxBytes: number, onExceeded: () => void) {
  let completedBytes = 0, exhausted = false
  const bytes = (stats: ConnectionStats) => stats.srcRxBytes + stats.srcTxBytes
  const check = () => {
    const activeBytes = proxy.getConnectionIds().reduce((total, id) => {
      const stats = proxy.getConnectionStats(id)
      return total + (stats ? bytes(stats) : 0)
    }, 0)
    if (!exhausted && completedBytes + activeBytes > maxBytes) { exhausted = true; onExceeded() }
  }
  const closed = ({ stats }: { stats: ConnectionStats }) => {
    completedBytes += bytes(stats)
    // proxy-chain emits before removing the connection from its active map.
    queueMicrotask(check)
  }
  proxy.on("connectionClosed", closed)
  // Sampling avoids intercepting socket writes; the limit can overshoot within
  // this interval. Docker's execution deadline remains an independent hard cap.
  const interval = setInterval(check, 100)
  interval.unref()
  return () => { clearInterval(interval); proxy.off("connectionClosed", closed) }
}
