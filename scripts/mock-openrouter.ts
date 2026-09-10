// Minimal OpenAI-compatible streaming mock for key-less local dev: `bun run mock` then `bun run dev:mock`.
// Streams a markdown reply token by token and logs when the client disconnects.
const reply = [
  "Here", " is", " a", " quick", " answer", " with", " **markdown**", ".\n\n",
  "- first", " point\n", "- second", " point\n", "- third", " point\n\n",
  "```ts\n", "export const", " add = ", "(a: number, b: number)", " => a + b\n", "```\n\n",
  "And a", " closing", " sentence", " that", " keeps", " streaming", " for", " a", " while", " longer", ".",
]
const delayMs = Number(process.env.MOCK_DELAY_MS ?? 120)

Bun.serve({
  port: Number(process.env.MOCK_PORT ?? 4010),
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname !== "/chat/completions") return new Response("not found", { status: 404 })
    const auth = req.headers.get("authorization") ?? ""
    if (!auth.startsWith("Bearer ")) return Response.json({ error: { message: "Missing Authentication header", code: 401 } }, { status: 401 })
    const body = await req.json()
    const latestUser = [...(body.messages ?? [])].reverse().find((message: { role: string }) => message.role === "user")
    const scrapeUrl = typeof latestUser?.content === "string" && /scrape|read/i.test(latestUser.content)
      ? latestUser.content.match(/https?:\/\/[^\s<>]+/)?.[0] : undefined
    const toolResult = [...(body.messages ?? [])].reverse().find((message: { role: string }) => message.role === "tool")
    const callTool = scrapeUrl && !toolResult && body.tool_choice !== "none" && body.tools?.some((tool: { function?: { name: string } }) => tool.function?.name === "scrapeUrl")
    const tokens = toolResult ? [`Scrape result: ${toolResult.content}`] : reply
    console.log(`[mock] POST model=${body.model} stream=${body.stream} messages=${body.messages?.length}`)
    const id = "gen-" + Math.random().toString(36).slice(2)
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model, provider: "Mock", choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }] })}\n\n`
    let aborted = false
    req.signal.addEventListener("abort", () => { aborted = true; console.log("[mock] client disconnected (abort)") })
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(chunk({ role: "assistant", content: "" }, null)))
        if (callTool) {
          controller.enqueue(enc.encode(chunk({ tool_calls: [{ index: 0, id: "scrape-1", type: "function", function: { name: "scrapeUrl", arguments: JSON.stringify({ url: scrapeUrl }) } }] }, null)))
          controller.enqueue(enc.encode(chunk({}, "tool_calls")))
          controller.enqueue(enc.encode("data: [DONE]\n\n"))
          controller.close()
          return
        }
        for (const token of tokens) {
          if (aborted) { console.log("[mock] stopped streaming early"); controller.close(); return }
          controller.enqueue(enc.encode(chunk({ content: token }, null)))
          await Bun.sleep(delayMs)
        }
        controller.enqueue(enc.encode(chunk({}, "stop")))
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model, choices: [], usage: { prompt_tokens: 5, completion_tokens: reply.length, total_tokens: 5 + reply.length } })}\n\n`))
        controller.enqueue(enc.encode("data: [DONE]\n\n"))
        console.log("[mock] finished")
        controller.close()
      },
      cancel() { aborted = true; console.log("[mock] stream cancelled") },
    })
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
  },
})
console.log("[mock] listening on :" + (process.env.MOCK_PORT ?? 4010))
