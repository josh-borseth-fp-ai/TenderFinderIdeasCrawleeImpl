import { describe, it, expect } from "vitest"
import { BrowserSession } from "../../../runner/session.ts"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
describe("browser ownership", () => {
  it("drains active agent input, holds queued input, and resumes the same session", async () => {
    const states: string[] = [], calls: string[] = []
    const session = new BrowserSession("page-1", (state) => states.push(state))
    let release!: () => void
    const first = session.agent(async () => { calls.push("first"); await new Promise<void>((resolve) => { release = resolve }) })
    await tick()
    const second = session.agent(async () => { calls.push("second") })
    const takeover = session.takeControl()
    release(); await first; await takeover
    expect(session.state).toBe("human-controlled")
    expect(calls).toEqual(["first"])
    await session.human(async () => { calls.push("human") })
    await session.continue(); await second
    expect(calls).toEqual(["first", "human", "second"])
    expect(states).toEqual(["awaiting-human", "human-controlled", "awaiting-human", "agent-controlled"])
  })
  it("rejects unauthorized human input and releases pending work on cancellation", async () => {
    const session = new BrowserSession("page-2")
    await expect(session.human(async () => {})).rejects.toThrow("not held")
    await session.awaitHuman()
    const pending = session.agent(async () => "never")
    session.close()
    await expect(pending).rejects.toThrow("closed")
  })
  it("releases the input permit after failures and serializes concurrent actions", async () => {
    const session = new BrowserSession("failures")
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const calls: string[] = []
    const first = session.agent(async () => {
      calls.push("first")
      entered.resolve()
      await release.promise
      throw new Error("page action failed")
    })
    const failure = expect(first).rejects.toThrow("page action failed")
    await entered.promise
    const second = session.agent(async () => { calls.push("second"); return 42 })
    await tick()
    expect(calls).toEqual(["first"])
    release.resolve()
    await failure
    await expect(second).resolves.toBe(42)
    await session.takeControl()
    await expect(session.human(async () => { throw new Error("human action failed") })).rejects.toThrow("human action failed")
    await session.continue()
    await expect(session.agent(async () => "resumed")).resolves.toBe("resumed")
    session.close()
  })
  it("closes queued actions promptly while draining an in-flight action", async () => {
    const session = new BrowserSession("closing")
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    let activeFinished = false, queuedRan = false
    const first = session.agent(async () => {
      entered.resolve()
      await release.promise
      activeFinished = true
    })
    const firstClosed = expect(first).rejects.toThrow("closed")
    await entered.promise
    const queued = session.agent(async () => { queuedRan = true })
    const queuedClosed = expect(queued).rejects.toThrow("closed")
    const takeover = expect(session.takeControl()).rejects.toThrow("closed")
    session.close()
    session.close()
    await queuedClosed
    await takeover
    expect(activeFinished).toBe(false)
    expect(queuedRan).toBe(false)
    release.resolve()
    await firstClosed
    expect(activeFinished).toBe(true)
    expect(session.state).toBe("closed")
    await expect(session.agent(async () => {})).rejects.toThrow("closed")
  })
  it("drains human input before resuming and rejects human work queued before release", async () => {
    const session = new BrowserSession("human")
    await session.takeControl()
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const calls: string[] = []
    const first = session.human(async () => { calls.push("human"); entered.resolve(); await release.promise })
    await entered.promise
    const queued = session.human(async () => { calls.push("stale human") })
    const rejected = expect(queued).rejects.toThrow("released")
    const continuing = session.continue()
    const agent = session.agent(async () => { calls.push("agent") })
    await tick()
    expect(calls).toEqual(["human"])
    release.resolve()
    await Promise.all([first, rejected, continuing, agent])
    expect(calls).toEqual(["human", "agent"])
    // The same latch must support subsequent pause/resume cycles.
    await session.takeControl()
    const next = session.agent(async () => { calls.push("next") })
    await tick()
    expect(calls).toEqual(["human", "agent"])
    await session.continue()
    await next
    session.close()
  })

})
