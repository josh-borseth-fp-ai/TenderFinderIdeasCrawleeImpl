import { Cause, Context, Effect, Exit, Layer, ManagedRuntime } from "effect"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { SourceStore } from "./Store.ts"
import { DockerRunner } from "./Runner.ts"
import { OnboardingService } from "./Service.ts"
import { SourceError } from "../../domain/Source.ts"
import { SourceModel } from "./SourceModel.ts"
import { ServerRuntime } from "../ServerRuntime.ts"

class Onboarding extends Context.Service<Onboarding, OnboardingService>()("@app/Onboarding") {}
const layer = Layer.effect(Onboarding, Effect.acquireRelease(
  Effect.sync(() => {
    const store = new SourceStore(process.env.SCRAPER_DATA_DIR ?? join(process.cwd(), ".data", "onboarding"))
    const runner = new DockerRunner(undefined, createHash("sha256").update(store.root).digest("hex").slice(0, 16))
    // Browsing saved sources stays independent of Docker and model credentials.
    const recovered = runner.recover().catch(() => {})
    return new OnboardingService(store, {
      identity: (signal) => runner.identity(signal),
      run: async (...args) => { await recovered; return runner.run(...args) },
    }, async (prompt, signal) => {
      const exit = await ServerRuntime.runPromiseExit(Effect.flatMap(SourceModel, (model) => model.decide(prompt)), { signal })
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        throw error instanceof SourceError ? error : new SourceError({ kind: "provider", message: error instanceof Error ? error.message : String(error) })
      }
      return exit.value
    })
  }),
  (service) => Effect.promise(async () => { await service.close(); service.store.close() }),
))

declare global {
  var __onboardingRuntime: ManagedRuntime.ManagedRuntime<Onboarding, never> | undefined
  // Explicit fixture injection for the key-free demo and API integration tests.
  var __onboardingService: OnboardingService | undefined
}
export async function onboarding(): Promise<OnboardingService> {
  if (globalThis.__onboardingService) return globalThis.__onboardingService
  const runtime = globalThis.__onboardingRuntime ??= ManagedRuntime.make(layer)
  return runtime.runPromise(Onboarding)
}
