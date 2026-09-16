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
})
