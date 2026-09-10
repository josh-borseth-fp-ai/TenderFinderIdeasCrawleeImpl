import { ManagedRuntime } from "effect"
import { appLayer } from "./Layers.ts"

type Runtime = ManagedRuntime.ManagedRuntime<
  Layer.Success<typeof appLayer>,
  Layer.Error<typeof appLayer>
>

declare global {
  // eslint-disable-next-line no-var
  var __serverRuntime: Runtime | undefined
}

/** Module singleton; stored on globalThis so Vite HMR does not rebuild the layer on every edit. */
export const ServerRuntime: Runtime = (globalThis.__serverRuntime ??= ManagedRuntime.make(appLayer))

import type { Layer } from "effect"
