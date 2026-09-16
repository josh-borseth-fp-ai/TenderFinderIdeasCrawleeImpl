import { createServer } from "node:http"

/** Deterministic websites used only by the isolated runner integration suite. */
export async function startFixtures(): Promise<number> {
  const server = createServer((request, response) => {
    const path = request.url ?? "/"
    if (path === "/robots.txt") { response.end("User-agent: *\nAllow: /\nDisallow: /forbidden"); return }
    if (path === "/json") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ bids: [{ title: "Bridge repair", sourceUrl: "http://fixture.test/detail", evidence: "Bridge repair", status: "open" }] })); return }
    if (path === "/private-redirect") { response.writeHead(302, { location: "http://127.0.0.1/" }); response.end(); return }
    response.setHeader("content-type", "text/html")
    if (path === "/rendered") response.end(`<html><body><main id="results"></main><script>document.querySelector('main').innerHTML='<a href="/detail">Bridge repair</a>'</script></body></html>`)
    else if (path === "/detail") response.end('<html><title>Bridge repair</title><main><h1>Bridge repair</h1><p data-buyer>City Works</p><p>Open</p></main></html>')
    else if (path === "/page2") response.end('<html><main><a href="/detail">Duplicate bid</a><a href="/excluded">Excluded bid</a></main></html>')
    else response.end('<html><main><a href="/detail">Bridge repair</a><a href="/page2">Next</a></main></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return (server.address() as { port: number }).port
}
