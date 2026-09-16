import { Mutex, Semaphore } from "async-mutex"

import type { ControlState } from "./contract.ts"
export { ControlState } from "./contract.ts"

/** Product ownership rules; async-mutex owns input serialization and wakeups. */
export class BrowserSession {
  state: ControlState = "agent-controlled"
  private readonly input = new Mutex(new Error("Browser session closed"))
  private readonly resumed = new Semaphore(1)
  private pausedAt: number | null = null
  private pausedMs = 0
  private readonly startedAt = Date.now()
  constructor(readonly id: string, private readonly changed: (state: ControlState) => void = () => {}) {}
  get activeMilliseconds() { return Date.now() - this.startedAt - this.pausedMs - (this.pausedAt === null ? 0 : Date.now() - this.pausedAt) }
  private set(state: ControlState) {
    if (state !== "agent-controlled" && this.pausedAt === null) this.pausedAt = Date.now()
    if (state === "agent-controlled" && this.pausedAt !== null) { this.pausedMs += Date.now() - this.pausedAt; this.pausedAt = null }
    this.state = state; this.changed(state)
  }
  async agent<T>(action: () => Promise<T>): Promise<T> {
    while (true) {
      await this.resumed.waitForUnlock()
      const release = await this.input.acquire()
      try {
        if (this.state === "closed") throw new Error("Browser session closed")
        // Ownership can change while an action waits for the input mutex.
        if (this.state === "agent-controlled") return await action()
      } finally { release() }
    }
  }
  async awaitHuman() {
    if (this.state === "closed") throw new Error("Browser session closed")
    this.set("awaiting-human")
    this.resumed.setValue(0)
    await this.input.waitForUnlock()
  }
  async takeControl() { await this.awaitHuman(); if (this.state !== "closed") this.set("human-controlled") }
  async human<T>(action: () => Promise<T>): Promise<T> {
    if (this.state !== "human-controlled") throw new Error("Human control is not held")
    return this.input.runExclusive(() => {
      if (this.state !== "human-controlled") throw new Error("Human control was released")
      return action()
    })
  }
  async continue() {
    await this.awaitHuman()
    if (this.state === "closed") return
    this.set("agent-controlled")
    this.resumed.setValue(1)
  }
  close() { this.set("closed"); this.input.cancel(); this.resumed.setValue(1) }
}
