import { RegistryProvider } from "@effect/atom-react"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import appCss from "@/styles.css?url"

const favicon =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
  )

const themeScript = `(function(){try{var t=localStorage.getItem("theme");var v=t?JSON.parse(t):"system";var d=v==="dark"||(v!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bid Desk Chat" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: favicon },
    ],
    scripts: [{ children: themeScript }],
  }),
  shellComponent: RootShell,
  component: Outlet,
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">Page not found.</main>
  ),
})

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased">
        <RegistryProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </RegistryProvider>
        <Scripts />
      </body>
    </html>
  )
}
