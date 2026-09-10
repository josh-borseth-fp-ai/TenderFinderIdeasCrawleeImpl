import { useAtomValue } from "@effect/atom-react"
import { useEffect } from "react"
import { themeAtom } from "@/atoms/theme"

const apply = (dark: boolean) => document.documentElement.classList.toggle("dark", dark)

/** Keeps the `dark` class on <html> in sync with themeAtom (and the OS when "system"). */
export function ThemeEffect() {
  const theme = useAtomValue(themeAtom)
  useEffect(() => {
    if (theme !== "system") {
      apply(theme === "dark")
      return
    }
    const media = matchMedia("(prefers-color-scheme: dark)")
    apply(media.matches)
    const onChange = (e: MediaQueryListEvent) => apply(e.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])
  return null
}
