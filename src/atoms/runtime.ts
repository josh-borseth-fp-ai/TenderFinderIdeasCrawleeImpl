import { BrowserKeyValueStore } from "@effect/platform-browser"
import { Layer } from "effect"
import { Atom } from "effect/unstable/reactivity"
import { ChatClient } from "./ChatClient.ts"

/** Single client runtime: every atom that needs a service hangs off this. */
export const runtime = Atom.runtime(Layer.merge(ChatClient.layer, BrowserKeyValueStore.layerLocalStorage))
