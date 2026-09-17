import { Deferred, Effect, Latch, Option, Schema, Semaphore } from "effect"

import type { ControlState } from "./contract.ts"
export { ControlState } from "./contract.ts"

class BrowserSessionError extends Schema.TaggedError<BrowserSessionError>()("BrowserSessionError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** Product ownership rules; Effect owns serialization, wakeups, and cancellation. */
export class BrowserSession {
  state: ControlState = "agent-controlled"
  private readonly input = Semaphore.makeUnsafe(1)
  private readonly resumed = Latch.makeUnsafe(true)
  private readonly closed = Deferred.makeUnsafe<never, BrowserSessionError>()
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
  private run<A, E>(work: Effect.Effect<A, E>): Promise<A> {
    return Effect.runPromise(Effect.raceFirst(work, Deferred.await(this.closed)))
  }
  private action<T>(action: () => Promise<T>) {
    // Playwright promises cannot be interrupted: keep the input permit until
    // an in-flight action settles, even when close cancels queued work.
    return Effect.uninterruptible(Effect.tryPromise({
      try: action,
      catch: (cause) => new BrowserSessionError({ message: cause instanceof Error ? cause.message : String(cause), cause }),
    }))
  }
  agent<T>(action: () => Promise<T>): Promise<T> {
    return this.run(Effect.gen({ self: this }, function*() {
      while (true) {
        yield* this.resumed.await
        const result = yield* this.input.withPermit(Effect.suspend(() => {
          if (this.state === "closed") return Effect.fail(new BrowserSessionError({ message: "Browser session closed" }))
          // Ownership can change while an action waits for the input permit.
          return this.state === "agent-controlled"
            ? Effect.asSome(this.action(action))
            : Effect.succeed(Option.none<T>())
        }))
        if (Option.isSome(result)) return result.value
      }
    }))
  }
  async awaitHuman() {
    if (this.state === "closed") throw new BrowserSessionError({ message: "Browser session closed" })
    this.set("awaiting-human")
    Effect.runSync(this.resumed.close)
    await this.run(this.input.withPermit(Effect.void))
  }
  async takeControl() { await this.awaitHuman(); if (this.state !== "closed") this.set("human-controlled") }
  async human<T>(action: () => Promise<T>): Promise<T> {
    if (this.state !== "human-controlled") throw new BrowserSessionError({ message: "Human control is not held" })
    return this.run(this.input.withPermit(Effect.suspend(() => this.state === "human-controlled"
      ? this.action(action)
      : Effect.fail(new BrowserSessionError({ message: "Human control was released" })))))
  }
  async continue() {
    await this.awaitHuman()
    if (this.state === "closed") return
    this.set("agent-controlled")
    Effect.runSync(this.resumed.open)
  }
  close() {
    if (this.state === "closed") return
    this.set("closed")
    Effect.runSync(Deferred.fail(this.closed, new BrowserSessionError({ message: "Browser session closed" })))
  }
}
