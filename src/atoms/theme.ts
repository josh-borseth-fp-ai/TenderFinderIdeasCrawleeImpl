import { Schema } from "effect"
import { Atom } from "effect/unstable/reactivity"
import { runtime } from "./runtime.ts"

export const Theme = Schema.Literals(["light", "dark", "system"])
export type Theme = typeof Theme.Type

/** Persisted in localStorage under "theme" (JSON encoded, read by the no-flash script in __root). */
export const themeAtom = Atom.kvs({
  runtime,
  key: "theme",
  schema: Theme,
  defaultValue: (): Theme => "system",
})
