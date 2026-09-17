import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  // The dependency scan visits server routes before Start strips their handlers.
  // Dockerode's SSH transport contains native addons that cannot be prebundled.
  optimizeDeps: { exclude: ["dockerode"] },
})
