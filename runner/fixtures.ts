import { createServer } from "node:http"

/** Deterministic websites used only by the isolated runner integration suite. */
export async function startFixtures(): Promise<number> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.test")
    const path = url.pathname
    if (path === "/empty") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ bids: [], total: 0 })); return }
    if (path === "/pages" || path === "/many") {
      const page = Number(url.searchParams.get("page") ?? "0")
      const count = path === "/many" ? 10005 : 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ bids: Array.from({ length: count }, (_, i) => ({ title: `Opportunity ${path === "/many" ? i : page}`, sourceUrl: `http://fixture.test/item/${path === "/many" ? i : page}`, evidence: `Opportunity ${path === "/many" ? i : page}`, status: "open" })), next: path === "/pages" && page < 4 ? `http://fixture.test/pages?page=${page + 1}` : null }))
      return
    }
    if (path === "/interactive") {
      response.setHeader("content-type", "text/html")
      response.end(`<html><body><main><h1>Opportunity 0</h1><span id="number">0</span></main><button id="next">Next</button><script>let n=0; document.querySelector('button').onclick=()=>{n++;document.querySelector('main').innerHTML='<h1>Opportunity '+n+'</h1><span id="number">'+n+'</span>';if(n===4)document.querySelector('button').remove();}</script></body></html>`)
      return
    }
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
